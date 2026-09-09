# Runbook: Security Incident

**Use when:** suspected credential compromise, unauthorized money movement, audit-chain
break, or any "someone is in the system who shouldn't be" signal.

**Context:** [../security/overview.md](../security/overview.md) ·
[../architecture/financial-kernel.md §4](../architecture/financial-kernel.md) ·
console: `/developers/keys`, `/developers/logs`, `/agents`, `/cards`, `/audit`

**Posture:** contain (revoke/freeze) → preserve evidence (audit chain, request logs) →
verify integrity → remediate. Order matters: containment before investigation on
anything that can still spend.

## 1. Contain — kill the credentials (minutes matter)

1. **Revoke compromised API keys** — `/developers/keys` → Revoke (calls
   `revokeApiKey`, `WARN`-audited). Revocation is effective on the *next request*:
   `authenticateApiKey` checks `status=ACTIVE`. Keys are hashed at rest, so if you
   don't know *which* key, revoke suspicious ones by `lastUsedAt`/`requestCount`
   anomalies in `/developers/logs` (`ApiRequestLog`: path, status, duration, redacted
   bodies).
2. **Freeze agents** — `/agents` → Pause (reversible, `agent.paused` WARN audit) for
   suspects; **Revoke** (terminal, `agent.revoked` CRITICAL audit) for confirmed
   compromise. A non-`ACTIVE` agent is rejected at `proposeAgentIntent` — no new
   intents, no approvals can execute.
3. **Freeze cards** — `/cards/[id]` → Freeze. Frozen cards fail authorization
   deterministically (`card is frozen`).
4. **Sessions** — force logout for affected users (`destroySession` revokes the
   session row; DB-level bulk `revokedAt` sweep if the account itself is suspect).
   Suspend the user (`status=SUSPENDED`) — session resolution then fails everywhere.
5. **Webhook endpoints** — if an endpoint secret leaked, register a replacement
   endpoint (new `nvwhsec_…` secret, returned once) and pause/remove the old one.

Money-level blast radius is bounded by design (agent per-txn/daily ceilings, card
limits/allowlists, org scoping) — containment is about stopping *further* movement, not
recouping what moved.

## 2. Preserve and inspect evidence

- **Request logs** (`/developers/logs`): what the compromised key actually did —
  method, path, status, duration, redacted body, error code, per-key counters.
- **Agent intent feed** (`/agents/[id]`): every proposal, the policy decision + reasons,
  the approval trail, the resulting `ltx_…` ledger reference or failure reason.
- **Payment timelines**: each intent → risk → rail → settle/refund step with actors.
- Do **not** modify any of this — it is the hash-chained record (below).

## 3. Verify the audit chain

`verifyAuditChain()` recomputes `sha256(prevHash ‖ canonical)` over every `AuditEvent`
in order and reports `{ totalEvents, verified, valid, firstBrokenAt? }`.

- Console: `/audit` runs it on load and displays validity (e.g. *818/818 valid*).
- The page reports the first broken event when the chain is invalid —
  `firstBrokenAt` is your tampering boundary: everything *before* it is trustworthy,
  everything after is suspect.

**A broken chain is the incident, not a side effect** — the database itself was written
outside the application. Preserve the file, snapshot it, and treat every financial
figure post-breakpoint as unproven until reconciled
([ledger-discrepancy.md](./ledger-discrepancy.md)).

## 4. Financial verification

1. `bun scripts/verify-balances.ts` — per-currency trial balance + negative-balance
   check must be green. If it isn't, switch to
   [ledger-discrepancy.md](./ledger-discrepancy.md) with P0 escalation.
2. Run the reconciliation scan (`/reconciliation`) — look for `UNKNOWN_REFERENCE`
   (rail movement with no intent) and `AMOUNT_MISMATCH` cases as evidence of
   unauthorized movement.
3. Reconcile any unauthorized transaction **reversal-only** — no direct row edits.

## 5. Remediate & review

- Rotate everything the incident touched: new API keys (old ones stay revoked —
  prefixes remain visible in logs for correlation), new agent credentials for
  re-registered agents, new webhook secrets.
- Close the hole the attacker used — map it to the red-team checklist in
  [../security/overview.md §6](../security/overview.md#6-red-team-checklist) (double-spend /
  replay / cross-tenant / prompt injection / tool abuse) and add the missing
  enforcement or test.
- Write the post-incident review referencing audit event ids — the chain is the
  authoritative timeline; notes should let a future auditor reconstruct decisions.
- If ledger or audit integrity was compromised, engineering + security sign-off is
  required before restoring agents/cards to `ACTIVE`.

## Quick reference — containment levers

| Lever | Where | Effect | Audit action |
|---|---|---|---|
| API key revoke | `/developers/keys` | Next request 401 | `apikey.revoked` (WARN) |
| Agent pause / revoke | `/agents` | New intents rejected | `agent.paused` (WARN) / `agent.revoked` (CRITICAL) |
| Card freeze | `/cards/[id]` | Auth declines deterministically | `card.frozen` |
| User suspend | user record | All sessions invalid | — |
| Session revoke | logout / DB sweep | Immediate invalidation | — |
| Wallet freeze | wallet record | Transfers out blocked | — |
