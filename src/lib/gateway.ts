import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { ref } from '@/lib/ids'

/**
 * PROVIDER GATEWAY — the rail abstraction layer.
 *
 * Novera owns intent, state, ledger, audit and reconciliation; providers
 * only execute external operations. This sandbox ships deterministic TEST
 * providers that simulate the rails (M-Pesa STK push, bank EFT, card
 * processor, USDC transfer). They are EXPLICITLY labeled mode=TEST and
 * never pretend to be production settlement (directive: no fake finance).
 *
 * Production adapters implement the same interface against real PSPs.
 */

export interface RailDispatchInput {
  providerId: string
  paymentId: string
  amountMinor: bigint
  currency: string
  method: string
  customerEmail?: string | null
  customerPhone?: string | null
  forceOutcome?: 'SUCCESS' | 'FAILURE' | 'PENDING'
}

export interface RailDispatchResult {
  ok: boolean
  externalReference: string
  status: 'SUBMITTED' | 'ACKNOWLEDGED' | 'SETTLED' | 'FAILED'
  latencyMs: number
  providerReference: string
  simulated: true
}

/** Deterministic outcome: derived from a hash of the payment id. */
function deterministicOutcome(seed: string, successRateBps: number): 'SUCCESS' | 'FAILURE' {
  const h = createHash('sha256').update(seed).digest()
  const bucket = h[0] * 256 + h[1] // 0..65535
  return bucket < successRateBps * 65535 / 10000 ? 'SUCCESS' : 'FAILURE'
}

export async function dispatchToRail(input: RailDispatchInput): Promise<RailDispatchResult> {
  const provider = await db.railProvider.findUnique({ where: { id: input.providerId } })
  if (!provider) throw new Error(`provider ${input.providerId} not found`)
  if (provider.mode !== 'TEST') {
    throw new Error('live providers are not available in this reference environment')
  }

  const externalReference = ref.providerTxn(provider.code)
  const outcome =
    input.forceOutcome ?? deterministicOutcome(`${provider.code}:${input.paymentId}`, provider.successRateBps)
  const latencyMs = provider.latencyMsAvg + ((createHash('md5').update(input.paymentId).digest()[0] % 60) - 30)

  const status: RailDispatchResult['status'] =
    outcome === 'SUCCESS' ? 'SETTLED' : 'FAILED'

  // Record the provider's own statement — reconciliation compares THIS
  // against the Novera ledger. Never the other way around.
  await db.providerTransaction.create({
    data: {
      providerId: provider.id,
      paymentId: input.paymentId,
      externalReference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status,
      settledAt: status === 'SETTLED' ? new Date() : null,
      rawPayload: JSON.stringify({
        simulated: true,
        provider: provider.code,
        rail: provider.railType,
        request: {
          paymentId: input.paymentId,
          amountMinor: input.amountMinor.toString(),
          currency: input.currency,
          method: input.method,
        },
        response: { externalReference, status, latencyMs },
      }),
    },
  })

  return {
    ok: outcome === 'SUCCESS',
    externalReference,
    status,
    latencyMs: Math.max(50, latencyMs),
    providerReference: provider.code,
    simulated: true,
  }
}

/** Default provider code per payment method. */
export const METHOD_PROVIDER_CODE: Record<string, string> = {
  MPESA: 'MPESA_V1',
  BANK: 'EQUITY_EFT',
  CARD: 'CARD_VISA',
  USDC: 'USDC_BASE',
  WALLET: 'NOVERA_INTERNAL',
}

export async function resolveProviderForMethod(method: string): Promise<string | null> {
  const code = METHOD_PROVIDER_CODE[method]
  if (!code) return null
  const provider = await db.railProvider.findUnique({ where: { code }, select: { id: true } })
  return provider?.id ?? null
}

/**
 * Provider routing: pick the operational provider with the best
 * (successRate / latency) score for the rail. Explainable output.
 */
export async function routeProvider(railType: string): Promise<{
  providerId: string | null
  providerCode: string | null
  rationale: string
}> {
  const providers = await db.railProvider.findMany({
    where: { railType, status: 'OPERATIONAL', mode: 'TEST' },
  })
  if (providers.length === 0) {
    return { providerId: null, providerCode: null, rationale: 'no operational provider for this rail' }
  }
  const ranked = providers
    .map((p) => ({
      p,
      score: p.successRateBps / Math.max(1, p.latencyMsAvg / 100),
    }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  return {
    providerId: best.p.id,
    providerCode: best.p.code,
    rationale: `${best.p.name}: success ${best.p.successRateBps / 100}% / ~${best.p.latencyMsAvg}ms — best operational score for ${railType}`,
  }
}
