'use server'

import { requireSession } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { Money, MoneyError, isCurrency } from '@novera/money'
import { WALLET_TYPES } from '@novera/domain'
import { addWallet } from '@/lib/provision'
import { executeTransfer, TransferError } from '@/lib/transfers'
import { recordAudit } from '@/lib/audit'

/**
 * WALLETS — mutations.
 *
 * All money is parsed with Money.fromMajor (never Number.parseFloat) so
 * decimal strings land in exact BigInt minor units. Every mutation is
 * audited: executeTransfer attributes the acting user inside the ledger
 * posting audit (via services); wallet creation gets an attributed
 * recordAudit here because addWallet's own audit carries no actor id.
 */

export type ActionResult = { ok: true; reference?: string } | { ok: false; error: string }

export interface CreateWalletInput {
  label: string
  type: string
  currency: string
  description?: string
}

export async function createWallet(input: CreateWalletInput): Promise<ActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  const label = (input.label ?? '').trim()
  if (!label) return { ok: false, error: 'Label is required.' }
  if (label.length > 60) return { ok: false, error: 'Label must be 60 characters or fewer.' }

  if (!WALLET_TYPES.includes(input.type as (typeof WALLET_TYPES)[number])) {
    return { ok: false, error: 'Unknown wallet type.' }
  }
  if (!isCurrency(input.currency)) {
    return { ok: false, error: `Unsupported currency: ${input.currency}` }
  }

  try {
    const wallet = await addWallet(orgId, label, input.type, input.currency, input.description?.trim() || undefined)
    await recordAudit({
      organizationId: orgId,
      actorType: 'USER',
      actorId: session.user.id,
      actorLabel: session.user.name,
      action: 'wallet.created',
      resourceType: 'Wallet',
      resourceId: wallet.id,
      description: `Wallet "${label}" (${input.currency}, ${input.type}) created via dashboard by ${session.user.name}`,
      metadata: { walletId: wallet.id, label, type: input.type, currency: input.currency, via: 'wallets-ui' },
    })
    revalidatePath('/wallets')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Wallet could not be created.' }
  }
}

export interface TransferInputForm {
  fromWalletId: string
  toWalletId: string
  amount: string
  note?: string
}

export async function transferFunds(input: TransferInputForm): Promise<ActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  if (!input.fromWalletId || !input.toWalletId) {
    return { ok: false, error: 'Choose both the source and destination wallet.' }
  }
  if (input.fromWalletId === input.toWalletId) {
    return { ok: false, error: 'Cannot transfer to the same wallet.' }
  }

  const amountRaw = (input.amount ?? '').trim()
  if (!amountRaw) return { ok: false, error: 'Amount is required.' }

  // Source + destination must share a currency; infer it from the source wallet.
  const [from, to] = await Promise.all([
    db.wallet.findFirst({ where: { id: input.fromWalletId, organizationId: orgId } }),
    db.wallet.findFirst({ where: { id: input.toWalletId, organizationId: orgId } }),
  ])
  if (!from || !to) return { ok: false, error: 'Wallet not found in this organization.' }
  if (from.currency !== to.currency) {
    return { ok: false, error: `Currency mismatch: ${from.label} is ${from.currency}, ${to.label} is ${to.currency}.` }
  }

  let amountMinor: bigint
  try {
    const money = Money.fromMajor(amountRaw, from.currency)
    if (money.minor <= BigInt(0)) return { ok: false, error: 'Amount must be greater than zero.' }
    amountMinor = money.minor
  } catch (err) {
    if (err instanceof MoneyError) {
      return { ok: false, error: `Invalid amount: ${err.message.replace(/^\[money\]\s*/, '')}` }
    }
    return { ok: false, error: 'Invalid amount.' }
  }

  const note = input.note?.trim() ?? ''

  try {
    // The ledger posting (and its audit event) attributes this user as the actor.
    const { txn } = await executeTransfer({
      organizationId: orgId,
      fromWalletId: input.fromWalletId,
      toWalletId: input.toWalletId,
      amountMinor,
      currency: from.currency,
      note: note || undefined,
      actor: { type: 'USER', id: session.user.id, label: session.user.name },
    })
    revalidatePath('/wallets')
    revalidatePath(`/wallets/${input.fromWalletId}`)
    revalidatePath(`/wallets/${input.toWalletId}`)
    revalidatePath('/transactions')
    return { ok: true, reference: txn.reference }
  } catch (err) {
    if (err instanceof TransferError) {
      return { ok: false, error: err.message.replace(/^\[transfers\]\s*/, '') }
    }
    return { ok: false, error: 'Transfer could not be posted.' }
  }
}
