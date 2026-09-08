# Runbook: Ledger Discrepancy

**Use when:** a trial balance doesn't balance, a wallet shows an impossible balance, a
recon case looks like real money disagreement, or an auditor asks "prove the books."

**Context:** [../architecture/financial-kernel.md](../architecture/financial-kernel.md) ·
[../architecture/provider-rails.md §4](../architecture/provider-rails.md) ·
console: `/transactions`, `/reconciliation`, `/audit`

> The ledger is truth; provider statements are evidence. Never "fix" the ledger to
> match a provider — that direction is what reconciliation exists to police.

## 0. Golden rules

1. **No direct writes.** Never `UPDATE`/`DELETE` posted `LedgerTransaction` /
   `LedgerEntry` rows — corrections are reversal-only (post a compensating
   transaction via the normal services).
2. **No auto-repair.** Every recon case resolves through a human decision with a note.
3. **FreeZE on CRITICAL.** For `AMOUNT_MISMATCH` / `CURRENCY_MISMATCH` involving live
   flows, pause the implicated surface (agent, split rule, checkout link) *before*
   investigating.

## 1. Establish the facts (2 minutes)

```bash
# headless: per-currency trial balance + wallet balances + negative-balance check
bun scripts/verify-balances.ts
```

- Every line must read `debits X credits X → OK` per currency and
  `PASS: no negative wallet balances`.
- In the console: `/transactions` renders the same trial-balance proof;
  `/audit` shows hash-chain validity (e.g. *842/842 valid*).

**If the audit chain is broken** → stop, this is a security incident, switch to
[security-incident.md](./security-incident.md).
**If the trial balance is unbalanced** → that is a *kernel bug*, not an ops case:
snapshot the DB file, capture the offending transaction references (`ltx_…`), and page
engineering. The invariant should be structurally unreachable (pre-post validation), so
treat it as a P0 code defect.

## 2. Run the reconciliation scan

Console: `/reconciliation` → **Run scan** (calls `runReconciliationScan(orgId)`), or
headless via a server action/script against the same function. The scan compares every
payment (excluding `CREATED`/`CANCELLED`) against its `ProviderTransaction` statements
and opens idempotent cases (keyed by payment + type + provider txn).

Read the summary: `compared / matched / discrepancies / newCases` + counts per type.

## 3. Triage the cases

| Case type (severity) | Likely cause | Default action |
|---|---|---|
| `MISSING_AT_PROVIDER` (HIGH) | Ledger settled but rail has no statement — sandbox: forced success path; production: lost webhook | Verify provider statement manually; if the rail truly never moved money, the settle posting must be reversed (reversal-only) |
| `AMOUNT_MISMATCH` (CRITICAL) | Fee/amount drift between booked and stated | Freeze the flow, compare `Payment.amountMinor` vs `ProviderTransaction.amountMinor`, decide which side is wrong; if ledger is wrong → compensating transaction, never an edit |
| `CURRENCY_MISMATCH` (CRITICAL) | Wrong-currency rail submission | Same as above; also check the wallet-currency guards |
| `STATUS_MISMATCH` (HIGH) | Ledger settled / rail pending (or reverse) | Check the payment timeline; if rail is authoritative-pending, the settle was premature — reverse and re-settle on true confirmation |
| `DUPLICATE` (MEDIUM) | Double submission at the rail | Confirm which provider txn is the real one; the duplicate stays as evidence with a dismiss note |
| `LATE_SETTLEMENT` (LOW) | >24h settlement skew | Usually informational — dismiss with a note |
| `UNKNOWN_REFERENCE` (HIGH) | Rail movement with no payment intent | Investigate as possible unauthorized rail activity; treat as security-adjacent |

## 4. Resolve — with a note, never silently

Console: `/reconciliation` → case → **Resolve** or **Dismiss**, with a resolution note
(calls `resolveCase(orgId, caseId, 'RESOLVED' | 'DISMISSED', note, actor)`).

What happens automatically: the case closes with resolver + note + timestamp, the
provider transaction flips to `reconciliationStatus=RESOLVED` with the resolution JSON,
and a `WARN` audit event (`reconciliation.case.resolved`) lands on the hash chain.
Nothing else is mutated.

**If money was actually wrong:** the correction is a *new* ledger transaction:
- Wrong settle → `reverseTransaction(org, txnId, reason, actor)` (mirrored entries,
  original flips to `REVERSED`, one-reversal-per-transaction enforced).
- Wrong refund leg → compensating posting via the same services, with the case id in
  the description/metadata.

## 5. Close out

- Re-run `bun scripts/verify-balances.ts` → green.
- Re-run the scan → no new cases for the resolved set.
- Confirm `/audit` chain still valid.
- Record the incident summary in the resolution notes (they are the audit trail —
  future readers should be able to reconstruct the decision without asking anyone).

**Escalation:** unbalanced trial balance, broken audit chain, or an `AMOUNT_MISMATCH`
you cannot explain → engineering P0 + security review
([security-incident.md](./security-incident.md)).
