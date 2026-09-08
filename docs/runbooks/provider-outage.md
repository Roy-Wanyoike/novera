# Runbook: Provider Outage / Degradation

**Use when:** a rail (M-Pesa / bank / card / USDC / internal) is failing, slow, or down;
payments pile up in `PENDING`/`FAILED`; or a provider's `status` flips to `DEGRADED` or
`DOWN`.

**Context:** [../architecture/provider-rails.md](../architecture/provider-rails.md) ·
[../architecture/overview.md §3](../architecture/overview.md) ·
console: `/payments` (filter: status), `/risk` (review queue), `/reconciliation`

> Honesty rule first: a payment that is `PROCESSING` is **never** shown as settled, and
> pending funds are never available. During an outage the correct behavior is *queues
> and truth*, not synthetic success.

## 1. Recognize it

- `/payments` shows a spike of `FAILED` (provider failure) or `PENDING` (risk review)
  concentrated on one method.
- Provider detail rows on payment pages show the failing provider code; the recon scan
  may open `STATUS_MISMATCH` cases (ledger settled vs provider not — see
  [ledger-discrepancy.md](./ledger-discrepancy.md) — in the reference build this
  indicates a forced/simulated path rather than a live rail, but treat the workflow as
  production rehearsal).
- `routeProvider(railType)` returns *"no operational provider for this rail"* when every
  provider on a rail is non-`OPERATIONAL`.

## 2. What the system already does for you

- **Routing is health-aware**: `routeProvider` only considers `status=OPERATIONAL`
  providers (`mode=TEST`) and ranks them by `successRateBps / (latencyMsAvg/100)`,
  returning an explainable rationale. With one provider down, traffic falls to the next
  operational provider on that rail (e.g. `CARD_MC` behind `CARD_VISA`).
- **Risk gates before rails**: `createPayment` runs `evaluateRisk` *before* dispatch;
  `DECLINE` fails fast with reasons, `REVIEW` parks the payment as `PENDING` in the
  manual queue (`/risk`) instead of burning a rail submission.
- **No fake settlements**: a failed dispatch is recorded honestly
  (`FAILED` + `failureReason`, timeline event, `payment.failed` webhook); a
  `PENDING` payment simply waits — the UI says "processing — watch the dashboard".
- **Provider statements are recorded per attempt** — recon has the evidence trail.

## 3. Operator actions

1. **Mark the provider's status** (`DEGRADED` if intermittent, `DOWN` if hard-down) —
   `RailProvider.status` is the routing input. Audit the change.
2. **Triage the PENDING queue** at `/risk` (risk `REVIEW` + `forceOutcome=PENDING`
   payments): approve → proceeds through the (next-best) rail; decline → `FAILED` with
   the reason. Decisions are audited.
3. **Retry policy for FAILED payments**: the console payment detail offers **Retry**
   only for `FAILED` payments — it creates a *fresh* payment through
   `createPayment` (new `pay_…` reference, new rail attempt, fresh risk evaluation).
   Never flip a payment's status by hand.
4. **Communicate honestly**: no status page lies, no "temporarily settled" states. The
   payment timeline is the customer-facing truth — each rail submission, provider ack,
   failure and retry is already an event on it.
5. **For OUT payouts on a down rail**: hold submissions (pause the source flow —
   agent/split rule/checkout link), since outbound money has no automatic hold-off in
   the reference build.

## 4. Recovery

- Provider back up → set `status=OPERATIONAL`, run a smoke payment per method.
- Re-run the reconciliation scan (`/reconciliation`) — expect `STATUS_MISMATCH` /
  `LATE_SETTLEMENT` cases for the outage window; resolve each with a note (see
  [ledger-discrepancy.md §3-4](./ledger-discrepancy.md)).
- Review `/developers/webhooks` delivery records: retry or replay `DEAD`/`FAILED`
  deliveries for `payment.settled`/`payment.failed` events the outage straddled.
- Post-incident: note actual failure rates in the provider record (`successRateBps`)
   so routing scores reflect reality.

## 5. Reference-build honesty notes

All providers here are deterministic TEST simulators — an "outage" is a simulated
condition (flip `status`, or `forceOutcome: 'FAILURE'`). That is precisely what makes
this runbook rehearseable end-to-end against the real state machines, ledger and recon
paths without touching a live PSP. `dispatchToRail` refuses any provider with
`mode !== 'TEST'`, so there is no accidental live-rail path from this environment.
