'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { runReconciliationScan, resolveCase } from '@/lib/recon'

/**
 * RECONCILIATION OPERATIONS — explicit, audited, never auto-repairing.
 *
 * runScan → runReconciliationScan (kernel: compares ledger vs provider
 * statements, opens cases, writes its own audit event).
 * resolve/dismiss → resolveCase (kernel: closes the case, marks the provider
 * statement RESOLVED, records the audit event).
 */

export interface ScanActionResult {
  ok: boolean
  message: string
  summary?: {
    compared: number
    matched: number
    discrepancies: number
    newCases: number
  }
}

export async function runReconciliationScanAction(): Promise<ScanActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  try {
    const summary = await runReconciliationScan(orgId)
    revalidatePath('/reconciliation')
    revalidatePath('/audit')
    return {
      ok: true,
      message: `Scan complete — ${summary.compared} compared, ${summary.matched} matched, ${summary.discrepancies} discrepancies.`,
      summary: {
        compared: summary.compared,
        matched: summary.matched,
        discrepancies: summary.discrepancies,
        newCases: summary.newCases,
      },
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Reconciliation scan failed.',
    }
  }
}

export interface CaseActionResult {
  ok: boolean
  message: string
}

const MIN_NOTE = 10

export async function resolveReconCase(caseId: string, note: string): Promise<CaseActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id
  const trimmed = note.trim()

  if (trimmed.length < MIN_NOTE) {
    return {
      ok: false,
      message: `Resolution note must be at least ${MIN_NOTE} characters — every resolution is audited.`,
    }
  }

  try {
    await resolveCase(orgId, caseId, 'RESOLVED', trimmed, {
      id: session.user.id,
      name: session.user.name,
    })
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error && err.message === 'case already closed'
          ? 'This case is already closed — refresh the queue.'
          : err instanceof Error && err.message === 'case not found'
            ? 'Case not found in this organization.'
            : 'Could not resolve the case.',
    }
  }

  revalidatePath('/reconciliation')
  revalidatePath('/audit')
  return { ok: true, message: 'Case resolved and recorded in the audit trail.' }
}

export async function dismissReconCase(caseId: string, reason: string): Promise<CaseActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id
  const trimmed = reason.trim()

  if (trimmed.length < MIN_NOTE) {
    return {
      ok: false,
      message: `Dismissal reason must be at least ${MIN_NOTE} characters — dismissals are audited too.`,
    }
  }

  try {
    await resolveCase(orgId, caseId, 'DISMISSED', trimmed, {
      id: session.user.id,
      name: session.user.name,
    })
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error && err.message === 'case already closed'
          ? 'This case is already closed — refresh the queue.'
          : err instanceof Error && err.message === 'case not found'
            ? 'Case not found in this organization.'
            : 'Could not dismiss the case.',
    }
  }

  revalidatePath('/reconciliation')
  revalidatePath('/audit')
  return { ok: true, message: 'Case dismissed — noted in the audit trail.' }
}
