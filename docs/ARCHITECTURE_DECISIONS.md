# Architecture Decision Records

Decision log for Novera's load-bearing choices. Each record: status, context,
decision, consequences. Records are immutable once accepted — superseding a decision
adds a new ADR that references the old one.

Related reading: [architecture/overview.md](architecture/overview.md) (the system these
decisions produce), [CONTRIBUTING.md](../CONTRIBUTING.md) (how to work inside them).

| ADR | Decision | Status |
|---|---|---|
| [0001](#adr-0001-sqlite-reference-build-postgresql-18-production-target) | SQLite reference build, PostgreSQL 18 production target | Accepted |
| [0002](#adr-0002-integer-minor-units-as-bigint) | Integer minor units as `BigInt` | Accepted |
| [0003](#adr-0003-deterministic-fail-closed-policy-engine) | Deterministic fail-closed policy engine | Accepted |
| [0004](#adr-0004-sandbox-providers-with-explicit-test-mode) | Sandbox providers with explicit TEST mode | Accepted |
| [0005](#adr-0005-two-leg-fx-clearing) | Two-leg FX clearing | Accepted |
| [0006](#adr-0006-hash-chained-audit-trail) | Hash-chained audit trail | Accepted |
| [0007](#adr-0007-llm-proposes-never-executes) | LLM proposes, never executes | Accepted |
| [0008](#adr-0008-reversal-only-corrections) | Reversal-only corrections | Accepted |

---

## ADR-0001: SQLite reference build, PostgreSQL 18 production target

**Status:** Accepted

**Context.** The system must run anywhere a reviewer can clone it — laptops, sandboxes,
CI containers — while the production target is a multi-tenant financial platform with
concurrent writers, row-level locking, and native enums. Maintaining two schemas
diverges fast.

**Decision.** One Prisma schema. The reference build runs it on SQLite
(`datasource db { provider = "sqlite" }`, `db/custom.db`); the production target is
PostgreSQL 18 with the same models. Consequences of SQLite are absorbed in known,
documented ways:

- All enums are `String` columns (SQLite has no native enums); the legal values and
  state machines are enforced in TypeScript by `@novera/domain` unions and guards
  (`canTransitionPayment`, `CARD_TRANSITIONS`, …), not by the database.
- The generated client is identical in shape, so services never branch on the engine.
- `bun run db:push` (not `migrate`) is the dev/CI workflow; a migration history is a
  production-target concern.

**Consequences.** (+) Zero-setup review and CI; one schema to document. (−) Enum
typos fail at runtime, not DDL time — mitigated by the domain unions; no row-level
locking — mitigated by structuring writes as single-transaction check-then-post
(`executeTransfer`) and by accepting that the reference build is not a
high-concurrency benchmark. Cross-DB numeric semantics stay consistent because all
money is stored as `BigInt` integers either way (ADR-0002).

---

## ADR-0002: Integer minor units as `BigInt`

**Status:** Accepted

**Context.** IEEE-754 floats cannot represent `0.1 + 0.2` exactly. Financial software
that does float arithmetic accumulates rounding drift that is invisible per-operation
and material in aggregate. Integers are exact; the question is representation width
and ergonomics.

**Decision.** All amounts are **integer minor units in `BigInt`** (`amountMinor:
BigInt` on every money column), wrapped by the `Money` class in
[`packages/money`](../packages/money/src/index.ts):

- Currency-qualified construction (`Money.fromMajor("1250.00", "KES")` parses decimal
  strings exactly; more precision than the currency supports throws).
- Cross-currency arithmetic throws (`assertSame`).
- Allocation (`allocateBps`, largest-remainder, deterministic index tie-break) — parts
  always sum exactly to the original.
- Rates are scaled integers (`rate × 10^8`) applied exactly with half-up rounding
  (`applyScaledRate`, `convertMinor` — the latter is minor-unit-scale-aware, e.g.
  KES=2 vs USDC=6).
- Serialization boundary: `.toString()` — BigInt never crosses the wire or reaches a
  client component; the API emits decimal strings.

**Alternatives rejected.** *Number-in-cents* — loses precision past 2^53 (fine for
cents, not for USDC micro-units or volume aggregates, and silent). *Decimal libraries*
— another dependency and an extra representation to keep out of storage; Prisma
stores `BigInt` natively. *Storing floats + careful rounding* — rejected outright:
correctness-by-discipline is not correctness.

**Consequences.** (+) Exact arithmetic, provable invariants, per-currency trial
balance that can be checked to the unit. (−) TS ergonomics (no `JSON.stringify`
directly; literals need target ≥ ES2020); every client boundary needs the
string-conversion discipline enforced by review and the PR checklist.

---

## ADR-0003: Deterministic fail-closed policy engine

**Status:** Accepted

**Context.** Agents (and any automated actor) must be bounded by rules that behave the
same way every evaluation, are auditable, and cannot be argued around — including by
an LLM. The engine sits on the money path: latency and determinism matter more than
expressive power.

**Decision.** [`@novera/policy`](../packages/policy/src/index.ts) is a **pure,
deterministic, fail-closed rule evaluator**:

- Rules: `{ name, priority, effect: ALLOW | REQUIRE_APPROVAL | DECLINE, conditions[] }`
  (AND within a rule; ops `eq/neq/in/not_in/lt/lte/gt/gte/contains`; money fields
  compare as bigint; special `scope` field has has/has-not semantics).
- Evaluation: sort by priority ascending; **first full match wins**; **no match →
  DECLINE** ("fail-closed default — least privilege").
- No I/O, no clock, no randomness — same facts + rules ⇒ same decision, forever.
- Agents get guardrails compiled from their KYA record
  (`buildAgentGuardrailRules`): ceilings (per-txn, daily) at priority 10/11, human
  approval gate at 20, scoped-allow at 100 — the ordering is the safety property.

**Consequences.** (+) Auditable decisions with persisted reasons; least-privilege by
default; trivially unit-testable (and covered by the invariant suite). (−) No
contextual intelligence — deliberately; intelligence belongs to the proposing plane
(ADR-0007), not the deciding one. (−) Rule sets are static per evaluation — dynamic
context (velocity) lives in the risk engine, which composes *before* the rail, not
after.

---

## ADR-0004: Sandbox providers with explicit TEST mode

**Status:** Accepted

**Context.** The platform needs to demonstrate and test the *full* money path —
dispatch, provider statements, reconciliation, failure handling — without moving real
money or implying that it did. "Demo mode" toggles that quietly fake success are the
failure mode to avoid.

**Decision.** Every `RailProvider` row carries `mode: TEST`, and the gateway
**refuses to dispatch to any provider whose mode is not TEST** ("live providers are
not available in this reference environment"). Providers are *deterministic*
simulators:

- Outcome derived from `sha256(providerCode:paymentId)` vs the provider's
  `successRateBps` — reproducible per payment.
- Latency = `latencyMsAvg` ± deterministic jitter.
- Every dispatch persists a faithful `ProviderTransaction` (the provider's statement),
  so reconciliation exercises the real comparison path.
- `forceOutcome` exists for seeding/testing failure paths, and the UI labels it
  explicitly (checkout's "simulate failure" checkbox).
- The type system participates: `RailDispatchResult.simulated: true` is a literal —
  production adapters implement the same interface without it.

**Consequences.** (+) The entire lifecycle (including failures, recon cases, retries)
is demonstrable and CI-testable with zero financial risk and zero ambiguity about
what happened; production adapters slot into an already-exercised seam. (−) A second
implementation burden (real PSPs) deferred with a documented contract
([provider-rails.md §5](architecture/provider-rails.md)); honesty rule permanently
load-bearing: TEST badges stay visible, `PROCESSING` is never `SETTLED`.

---

## ADR-0005: Two-leg FX clearing

**Status:** Accepted

**Context.** The ledger's invariant is *per-currency* debits = credits. A conversion
KES→USD changes the amount *and* the unit; any single transaction containing both
currencies' entries either can't balance per currency or would balance only by
numerical coincidence, making the invariant meaningless.

**Decision.** Each conversion posts **two balanced single-currency transactions**
bridged through the multi-currency `FX_CLEARING` account
([`src/lib/fx.ts`](../src/lib/fx.ts)):

```
Txn A (base):   Dr FX_CLEARING (KES)   / Cr source wallet (KES)   — key fx-a:{quoteId}
Txn B (quote):  Dr target wallet (USD) / Cr FX_CLEARING (USD)     — key fx-b:{quoteId}
```

Rates are locked at quote time (scaled integers ×10^8, spread in bps, 60s expiry);
`convertMinor` handles differing minor-unit scales exactly. Each leg carries its own
idempotency key.

**Alternatives rejected.** *One mixed transaction* — breaks the per-currency proof.
*Revaluing a single FX position account* — a valuation model, not a movement model;
the reference build books actual flows.

**Consequences.** (+) Per-currency invariant stays local and provable after every
conversion; the clearing account explains the bridge and nets to zero per currency at
a consistent rate. (−) Two rows per conversion (UI groups them via the shared quote);
FX gain/loss beyond rounding needs the `FX_GAIN` account at valuation time
(production concern; documented in [financial-kernel.md §7](architecture/financial-kernel.md)).

---

## ADR-0006: Hash-chained audit trail

**Status:** Accepted

**Context.** Financial systems need *tamper-evidence*, not just logging: an attacker
(or a bad deploy) with database access must be unable to rewrite history invisibly.
Centralized WORM storage is heavy for a reference build; plain append-only tables are
trustworthy only until someone edits them.

**Decision.** Every consequential mutation appends an `AuditEvent` whose hash chains
to its predecessor ([`src/lib/audit.ts`](../src/lib/audit.ts)):

```
hash(n) = sha256( canonical(event n) ‖ prevHash(n-1) )   // prev of the first event: "GENESIS"
```

The canonical form covers org, action, resource, actor, severity, correlation id,
metadata and timestamp. `verifyAuditChain()` recomputes the chain and reports
`firstBrokenAt` — everything before the break is trustworthy, everything after is
suspect. The `/audit` console page runs verification live (e.g. *842/842 valid*), and
the security-incident runbook treats a break as the incident itself.

**Consequences.** (+) Tamper-evidence with zero infra; retroactive edits cascade and
are detectable; verification is a one-call forensic gate. (−) Reference-build
limitations, stated honestly: ordering is `createdAt` (ms resolution, not a monotonic
sequence), the chain is global across orgs (fine for tamper-evidence, weak for per-org
proofs), and verification is pull-based rather than continuous. Production target:
per-org sequence numbers + periodic anchored checkpoints (external timestamping).

---

## ADR-0007: LLM proposes, never executes

**Status:** Accepted

**Context.** LLMs are probabilistic: capable, occasionally wrong, and manipulable
(prompt injection). Ledgers require deterministic correctness. Putting an LLM anywhere
in the write path of a financial system is the architecture failure this platform
exists to prevent.

**Decision.** The intelligence plane is structurally read/propose-only:

1. **Agents** (`src/lib/agents.ts`): an LLM-driven actor calls
   `proposeAgentIntent()`. The intent is an untrusted proposal row; the deterministic
   policy engine (ADR-0003) classifies it (`ALLOW` executes within limits /
   `REQUIRE_APPROVAL` creates a human `ApprovalRequest` / `DECLINE` is recorded as
   `POLICY_DENIED`). The only money-movement function, `executeAgentIntent()`, is
   reachable **exclusively** from a policy `ALLOW` or a human approval — there is no
   code path from model output to `postTransaction()`.
2. **Copilot** (`src/app/api/copilot/route.ts`): two-call pattern — the model routes
   to ONE tool from a fixed catalog; the tool is a pure, org-scoped, deterministic
   query; the model writes prose from the tool result only, with grounding tags
   (`GROUNDED / CALCULATED / ESTIMATED / UNKNOWN`). Model unreachable ⇒ honest
   fallback, never fabricated numbers.
3. Money-movement tools are *scopes* an agent may be granted; policy maps them to
   actions — an unscoped tool falls through to fail-closed DECLINE.

**Consequences.** (+) Model hallucination, drift, and prompt injection can produce at
worst a denied or human-reviewed proposal — never a ledger posting; the blast radius
of a compromised prompt is the agent's KYA envelope. (−) Human approval latency for
large amounts (the point); agent "autonomy" is bounded by design and must be marketed
as such.

---

## ADR-0008: Reversal-only corrections

**Status:** Accepted

**Context.** Money already moved is a historical fact. Editing a posted transaction —
to fix an amount, a direction, or a typo — silently rewrites the past: balances derived
from entries change without any record that they changed, and audit trails stop
matching the books.

**Decision.** Posted `LedgerTransaction`/`LedgerEntry` rows are **immutable in
application code**. Corrections are new transactions:

- `reverseTransaction(org, txnId, reason, actor)` creates a mirrored posting (same
  accounts/amounts, directions swapped) linked by `reversalOfId`, and marks the
  original `REVERSED` so balance aggregation excludes it.
- Exactly **one reversal per transaction** — double-reversal is refused.
- Only `POSTED` transactions can be reversed.
- Refunds follow the same philosophy: compensating entries against the original
  accounts (`Dr SALES / Cr wallet + Cr FEE_EXPENSE`), never edits to the settle
  transaction.

**Consequences.** (+) History is always reconstructible — an auditor sees the error,
the correction, and the reason; balances are a pure function of the append-only entry
log; "fix in place" bugs are structurally impossible. (−) The books accumulate
compensating pairs (intentional — that *is* the audit story); reversal is all-or-nothing
per transaction, so partial corrections post their own compensating legs (as refunds
do).
