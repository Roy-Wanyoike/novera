<div align="center">

# Novera

### Programmable Financial Infrastructure for the AI Economy

**AI proposes. Policy authorizes. The ledger records. Rails settle.**

Wallets · Payments · Cards · Treasury · FX · Programmable Money · Governed AI Agents
— on a deterministic, double-entry financial kernel.

[One-Minute Version](#-the-one-minute-version) · [Evidence](#-what-is-actually-built) · [Architecture](#-architecture) · [Financial Kernel](#-the-financial-kernel-verified) · [Agentic Finance](#-agentic-finance-know-your-agent) · [Run It](#-run-it-in-four-commands) · [Review Path](#-for-reviewers-a-15-minute-path)

</div>

---

## 📊 The One-Minute Version

**The problem.** The next wave of commerce won't be typed by humans. AI agents will
book freight, settle invoices, top up wallets and pay suppliers. But no serious
financial system can let a probabilistic model write directly to money — and no
regulator will allow it. Every bank-grade ledger ever built assumes a human, or a
deterministic program, at the controls.

**The solution.** Novera is a financial platform architected from first principles
for that world. It separates the three things everyone else entangles:

```text
┌───────────────────────────────────────────────────────────────┐
│                      INTELLIGENCE PLANE                       │
│      AI · Copilot · Agents · Forecasting · Document AI        │
│              Can reason and propose — never execute.          │
└──────────────────────────────┬────────────────────────────────┘
                               │ intent
┌──────────────────────────────▼────────────────────────────────┐
│                        CONTROL PLANE                          │
│   Identity · Policy · Risk · Limits · Compliance · Approvals  │
│              Can allow or reject — fail-closed.               │
└──────────────────────────────┬────────────────────────────────┘
                               │ authorized intent
┌──────────────────────────────▼────────────────────────────────┐
│                  FINANCIAL EXECUTION PLANE                    │
│      Ledger · Payments · Cards · Rails · FX · Settlement      │
│              Execute and account — immutably.                 │
└───────────────────────────────────────────────────────────────┘
```

**The moat.** Anyone can call an LLM. The hard, defensible part — and what Novera
actually implements — is the boundary: a deterministic policy engine, a
double-entry kernel where `SUM(debits) = SUM(credits)` is enforced per currency,
reversal-only corrections, idempotency on every money mutation, and a
tamper-evident hash-chained audit trail that a regulator or auditor can recompute
independently. That boundary is the product.

**The proof.** This is not slideware. The repo contains a working reference build:
200 seeded payments flow through the *real* kernel services, 89 invariant tests
pass in CI, the audit chain (818 events) verifies end-to-end, and a live,
key-authenticated REST API with idempotent semantics and HMAC-signed webhooks is
curl-able in one command. **Verify every claim yourself — the commands are below.**

**The path.** Prove the model at reference-build cost, then scale it on
infrastructure that deserves money (see [ADR-0001](docs/ARCHITECTURE_DECISIONS.md)):
the kernel semantics, state machines and contracts in this repo map 1:1 to the
production target — Java 25 / Spring core services, Go provider gateways, Python
intelligence services, PostgreSQL 18 as the single source of financial truth,
NATS JetStream events, Temporal workflows, OpenTelemetry observability.

> **Honesty by design.** All providers in this build are deterministic TEST
> simulators, clearly labeled in the UI. No real funds move. This is deliberate
> (see [ADR-0004](docs/ARCHITECTURE_DECISIONS.md)) — the financial semantics are
> production-shaped; the rails are simulated until there's a license to touch them.

---

## 🔬 What Is Actually Built

Every number below was re-derived from a freshly seeded database and a live test
run — not estimated, not promised.

| Claim | Evidence (live-verified) |
|---|---|
| Double-entry invariant holds | Trial balance balances **exactly** across all 3 currencies: KES 4,568,633.60 = 4,568,633.60 · USD · USDC |
| Audit trail is tamper-evident | **818/818** events re-verify against the sha256 hash chain |
| Kernel invariant tests | **89/89 passing** — money (30) · policy (18) · ledger (20) · FX (14) · payments (7) |
| The seed *is* an integration test | 200 payments · 367 ledger transactions · 1,085 ledger entries · 209 risk evaluations · 16 reconciliation cases — all driven through the real kernel services |
| Real product surface | 19 dashboard areas · hosted checkout · 8 REST API groups + OpenAPI document |
| Domain model | **35 Prisma models** — ledger, payments, cards, agents, policies, webhooks, recon |
| Engineering discipline | 8 ADRs · 4 architecture docs · 3 operator runbooks · security overview · CI gates on every PR |

**Verify it yourself (≈2 minutes):**

```bash
git clone https://github.com/BLACK23D/novera.git && cd novera
bun install && bun run db:push
bun prisma/seed.ts        # watch it print: trial balance OK, 818/818 audit chain OK
bun run test              # watch 89/89 invariant tests pass
```

The seed script doesn't insert rows — it *executes* payments, splits, card
authorizations, FX conversions, agent intents and refunds **through the same
kernel services the API and UI use**, then asserts the invariants. If the kernel
is wrong, the seed fails loudly.

---

## 🏗️ Architecture

The canonical lifecycle of every money movement:

```mermaid
flowchart LR
    A[Application / AI Agent] -->|Financial Intent| B[Authentication]
    B --> C[Policy Engine]
    C --> D[Risk Engine]
    D --> E[Financial Service]
    E --> F[Double-Entry Ledger]
    F --> G[Provider Gateway]
    G --> H[External Rails]
    H --> I[Reconciliation]
    I -->|proves external consistency| F
```

Three decisions define the system:

- **The ledger is the source of truth.** Balances are always *derived* from
  immutable entries — never stored, never cached. Redis would cache reads; it
  would never hold a balance as fact.
- **Providers are rails, not truth.** M-Pesa, banks, cards and USDC sit behind one
  provider abstraction. Reconciliation compares provider statements against the
  ledger and turns mismatches into operator cases — nothing silently auto-repairs.
- **AI never touches money directly.** An LLM produces an *intent*; a
  deterministic, fail-closed policy engine classifies it `ALLOW`,
  `REQUIRE_APPROVAL` or `DECLINE`. Unknown input is rejection, not guess.

Full documentation: [`docs/architecture/`](docs/architecture/overview.md) ·
[Financial Kernel](docs/architecture/financial-kernel.md) ·
[Agentic Finance](docs/architecture/agentic-finance.md) ·
[Provider Rails](docs/architecture/provider-rails.md) ·
[ADRs](docs/ARCHITECTURE_DECISIONS.md) ·
[Security](docs/security/overview.md) · [Runbooks](docs/runbooks/)

---

## 💰 The Financial Kernel (Verified)

The kernel is the most important component in Novera, and it is *real* — not
decorated CRUD over a balances table.

| Invariant | Enforcement |
|---|---|
| `SUM(debits) = SUM(credits)` — per currency | Validated before every post; provable after via `trialBalance()` |
| Posted records are immutable | No update/delete path exists; corrections are **reversal-only** mirror transactions (ADR-0008) |
| Balances derive from entries | `accountBalance()` aggregates entries at read time, including reversal netting |
| Every money-mutation is idempotent | Idempotency keys on postings, settlements, refunds, agent executions |
| Money is never a float | `@novera/money`: BigInt minor units + currency table; `KES + USD` **throws** |
| Allocation never leaks units | Largest-remainder `allocateBps()` — parts sum *exactly* to the source, ×50 randomized test cases |
| The audit trail is tamper-evident | `sha256(prevHash ‖ canonical)` chain; `verifyAuditChain()` recomputes all 818 events |
| FX respects minor-unit scales | Two single-currency postings through FX clearing; scale-aware conversion (ADR-0005) |

Posting semantics — read from the code, not the brochure:

```ts
// Customer pays KES 1,000.00 via M-Pesa (fee KES 48.00, net KES 952.00)
await postTransaction({
  description: 'MPESA collection pay_…',
  source: 'PAYMENT',
  idempotencyKey: `settle:${payment.id}`,
  entries: [
    { account: WALLET_OPERATING, direction: 'DEBIT', amountMinor: 95_200n, currency: 'KES' },
    { account: FEE_EXPENSE,      direction: 'DEBIT', amountMinor: 4_800n,  currency: 'KES' },
    { account: SALES,            direction: 'CREDIT', amountMinor: 100_000n, currency: 'KES' },
  ],
})
```

**Proven by tests** — `bun run test`:

```text
tests/money.test.ts               30 passing   (allocation exactness ×50 randomized cases)
tests/policy.test.ts              18 passing   (fail-closed, boundaries, determinism ×100)
tests/fx.test.ts                  14 passing   (scaled rates, cross-currency minor units)
tests/ledger.invariants.test.ts   20 passing   (balance, idempotency, reversal, trial balance)
tests/payments.invariants.test.ts  7 passing   (settlement legs, refund netting, replay safety)
```

---

## 🤖 Agentic Finance (Know Your Agent)

Every AI agent is a first-class, governed financial actor — the feature that
makes Novera infrastructure *for the AI economy* rather than another wallet:

```text
Agent (identity + hashed credential, shown once)
  → Intent (LLM proposal — untrusted until validated)
  → Deterministic policy (per-txn ceiling, daily ceiling, approval threshold, scopes)
  → ALLOW → ledger  |  REQUIRE_APPROVAL → human queue  |  DECLINE → denied + audited
```

Try it in the demo: **Agents → Atlas** (procurement) proposes a KES 40,000
payment — above its KES 30,000 approval threshold, so the deterministic gate
escalates it to the human approval queue. Approve it, and watch the intent
execute *on the real ledger*, with the full decision trail audited. Propose
KES 220,000 and watch the policy hard-decline it.

- **Atlas** (procurement): pays ≤ KES 45,000/txn, ≤ KES 150,000/day.
- **Meridian** (treasury): read-only. It cannot move money at all.
- Scopes, merchant allowlists, revocation, per-agent wallets, full intent audit.

The copilot answers questions only through deterministic, org-scoped query
tools — with a visible **provenance chip** (`GROUNDED` / `ESTIMATED` /
`UNKNOWN`) on every answer. It never fabricates figures; projections are labeled
as projections. ([ADR-0007: LLM proposes, never executes.](docs/ARCHITECTURE_DECISIONS.md))

---

## 🖥️ The Product Surface

One platform, twelve layers — the surface a real fintech operator needs:

| Layer | Where it lives |
|---|---|
| Identity & Organizations | scrypt auth, sessions, roles, org scoping (server-enforced) |
| Financial Kernel | `packages/*`, `src/lib/ledger.ts`, `/transactions` (trial balance UI) |
| Wallets & Money Movement | `/wallets`, `/payments`, transfers with available-vs-reserved |
| Rails (sandbox) | M-Pesa · bank EFT · Visa · USDC behind `src/lib/gateway.ts` |
| Checkout & Links | `/pay/[token]` hosted checkout, payment links + QR |
| Invoicing | `/invoices` — line items, 16% VAT math in BigInt, partial payments |
| Cards | `/cards` — issue/freeze/terminate, MCC & channel controls, auth simulator |
| Treasury & FX | `/treasury` cash position + forecast (labeled ESTIMATED), `/fx` locked quotes |
| Programmable Money | `/rules` — versioned split rules with zero-leakage simulation |
| Risk & Recon | `/risk` review queue (approve-and-settle works), `/reconciliation` ops center |
| Agentic Finance | `/agents`, `/approvals`, `/copilot` |
| Developer Platform | `/developers` + **live REST API** below |

### Screenshots

| | |
|:---:|:---:|
| ![Landing](docs/assets/landing.png) | ![Dashboard](docs/assets/dashboard.png) |
| *Landing — the three-plane story* | *Dashboard — cash position, split waterfall, agentic activity* |
| ![Agents](docs/assets/agents.png) | ![Ledger](docs/assets/ledger.png) |
| *Know-Your-Agent registry with policy gates* | *Double-entry explorer with per-currency trial balance* |

---

## 🛠 Developer Platform

A real, key-authenticated API — not screenshots:

```bash
# create a payment (idempotent) with the seeded TEST key
curl -s -X POST http://localhost:3000/api/v1/payments \
  -H "Authorization: Bearer nv_test_demo0001secret" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "1500.00",
    "currency": "KES",
    "method": "MPESA",
    "customerEmail": "buyer@example.com",
    "idempotencyKey": "order-4711"
  }'
```

Replay the same `idempotencyKey` and you get the **same payment** — one
financial effect, always. Keys are stored as SHA-256 hashes (the secret is shown
once at creation), rate-limited per key, and every request is logged (redacted)
for the portal's request-log viewer. Webhooks are HMAC-SHA256-signed with
retry/dead-letter status and manual replay — the seeded sandbox includes 208
delivery records exercising exactly that lifecycle. Live OpenAPI document:
`GET /api/v1/openapi.json`.

---

## 📦 Repository

```text
├── packages/            # pure domain packages (no framework deps)
│   ├── money/           #   BigInt minor units, exact allocation
│   ├── domain/          #   status unions, state machines, presentation metadata
│   ├── policy/          #   deterministic fail-closed policy DSL
│   └── events/          #   domain event catalog
├── src/
│   ├── lib/             # kernel services: ledger, payments, risk, policy,
│   │                    #   gateway (rails), agents, cards, fx, recon, webhooks,
│   │                    #   audit (hash chain), auth, api-auth
│   └── app/
│       ├── (app)/       # 19 dashboard areas (wallets → developers)
│       ├── (auth)/      # login / register
│       ├── pay/[token]/ # public hosted checkout
│       └── api/v1/      # public REST API (8 groups + OpenAPI)
├── prisma/              # schema (35 models) + kernel-driven deterministic seed
├── tests/               # 89 invariant tests (vitest)
├── docs/                # architecture, security, runbooks, ADRs, API notes
└── .github/workflows/   # CI: typecheck → lint → db push → invariant tests
```

### Reference build → production path

This repo is a TypeScript reference implementation that proves the model at
minimum viable complexity — a deliberate engineering-economics decision
([ADR-0001](docs/ARCHITECTURE_DECISIONS.md)). The semantics map 1:1 to the
production target:

| Concern | This repo (reference) | Production target |
|---|---|---|
| Financial truth | SQLite (dev-ergonomic, kernel-enforced) | PostgreSQL 18, same 35-model schema |
| Kernel services | TypeScript modules | Java 25 / Spring |
| Provider gateways | Deterministic simulators | Go services, real rails |
| Intelligence plane | Tool-governed copilot | Python services, same boundary rules |
| Durability / events | Idempotent transactions | NATS JetStream + Temporal workflows |
| Observability | Structured logs + audit chain | OpenTelemetry traces/metrics/logs |

---

## 🚀 Run It in Four Commands

```bash
bun install
bun run db:push               # apply schema
bun prisma/seed.ts            # 200 payments through the REAL kernel + invariant checks
bun run dev                   # → http://localhost:3000
```

| | |
|---|---|
| **Dashboard login** | `demo@novera.africa` / `novera-demo-2026` (or the one-click demo button) |
| **API key (TEST)** | `nv_test_demo0001secret` |
| **Agent credential** | Atlas the procurement agent — `nv_agent_procure01secret` |

**Worth trying first:**

1. **Dashboard** → cash position, split-rule waterfall, live ops glance.
2. **Agents → Atlas** → use the *intent simulator* to propose a KES 40,000
   payment: the deterministic policy gate escalates it to human approval.
3. **Approvals** → approve it and watch the intent execute **on the real ledger**.
4. **Rules** → simulate the 10/20/70 revenue waterfall on any amount —
   parts sum *exactly* (largest-remainder allocation, zero rounding leakage).
5. **Payments** → open any payment and read its full transparency timeline
   (risk evaluation → rail submission → settlement → ledger reference).
6. **Reconciliation** → run the scan: 4 injected discrepancy classes become
   operator cases with both sides of the story.
7. **Copilot** → ask *"What is my cash position?"* — every answer carries a
   provenance chip showing which deterministic tool produced the data.
8. **Audit** → the hash-chain verifier confirms the append-only trail is intact.

---

## 🔍 For Reviewers: A 15-Minute Path

Reviewing this repo as an investor or an engineering candidate? Don't take the
README's word for anything — this is the fastest way to evaluate the claim
"real financial engineering, not a demo skin":

| Minutes | Do this | What it proves |
|---|---|---|
| 2 | Read [`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md) — 8 ADRs | Decisions are documented with consequences, not vibes |
| 3 | Read [`packages/money/src/index.ts`](packages/money/src/index.ts) | Float-free money, exact allocation, currency guards |
| 3 | Read [`src/lib/audit.ts`](src/lib/audit.ts) | Hash-chained, append-only, independently recomputable audit |
| 3 | Read [`packages/policy/src/index.ts`](packages/policy/src/index.ts) | Fail-closed deterministic policy DSL with unknown-input rejection |
| 4 | `bun run test` and `bun prisma/seed.ts` | 89/89 invariants + trial balance + 818/818 audit chain — live |

If you're evaluating *engineering judgment*, the most honest artifact in this
repo is [ADR-0001](docs/ARCHITECTURE_DECISIONS.md): choosing SQLite for the
reference build — while explicitly designing the schema and semantics for
PostgreSQL 18 — is the kind of deliberate trade-off that separates
infrastructure that ships from infrastructure that stalls.

---

## 🧭 Engineering Culture

For recruiters, the practices matter more than the features:

- **Invariants over anecdotes** — the test suite is named after properties
  (`ledger.invariants`, `payments.invariants`), not screens.
- **Honest labels** — simulated providers say `TEST MODE` in the UI; the
  copilot's projections are labeled `ESTIMATED`; nothing pretends to be live.
- **Documentation-as-code** — architecture docs, security overview, three
  operator runbooks (ledger discrepancy, provider outage, security incident)
  and ADRs live in the repo and move with the code.
- **CI gates, not gatekeeping theater** — every PR runs typecheck, lint, a
  fresh-database schema push and the full invariant suite
  ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- **Contributor discipline** — [`CONTRIBUTING.md`](CONTRIBUTING.md) encodes a PR
  checklist that mirrors this README's claims: ledger invariants, idempotency,
  security review, no fake finance.

**Where the hard problems live** (the parts worth interviewing about):
double-entry correctness under reversal and refund netting
([`src/lib/ledger.ts`](src/lib/ledger.ts)), zero-leakage allocation
([`packages/money`](packages/money)), the fail-closed policy DSL
([`packages/policy`](packages/policy)), idempotent settlement legs
([`src/lib/payments.ts`](src/lib/payments.ts)), and the FX two-leg clearing
model ([`src/lib/fx.ts`](src/lib/fx.ts)).

---

## ✅ Quality Gates

- `bunx tsc --noEmit` — zero type errors
- `bun run lint` — clean
- `bun run test` — **89/89 invariant tests green**
- Seed-verified: per-currency trial balance, audit hash chain (818/818),
  non-negative balances
- Server-side authorization everywhere; every query org-scoped (IDOR-safe);
  every mutation audited

<div align="center">

---

**Novera — every debit has a credit. Every AI action has a policy gate.
Every money movement has a story you can reconstruct.**

*Built by [Denis Kelvin Murithi](https://github.com/BLACK23D). Contributions follow
[CONTRIBUTING.md](CONTRIBUTING.md).*

</div>
