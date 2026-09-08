<div align="center">

# Novera

### Programmable Financial Infrastructure

**AI proposes. Policy authorizes. The ledger records.**

Wallets · Payments · Cards · Treasury · Programmable Money · Controlled AI Agents
on a deterministic double-entry financial kernel.

[Live Demo](#-live-demo) · [Architecture](#-architecture) · [The Financial Kernel](#-the-financial-kernel) · [Agentic Finance](#-agentic-finance-know-your-agent) · [Developer Platform](#-developer-platform) · [Getting Started](#-getting-started)

</div>

---

## Why Novera exists

Payment infrastructure for the AI economy needs a hard separation between
**probabilistic systems** (LLMs, copilots, autonomous agents) and **deterministic
systems** (authorization, ledgering, settlement). Novera is built as three planes:

```text
┌───────────────────────────────────────────────────────────────┐
│                      INTELLIGENCE PLANE                       │
│      AI · Copilot · Agents · Forecasting · Document AI        │
│                     Can reason and propose.                   │
└──────────────────────────────┬────────────────────────────────┘
                               │ intent
┌──────────────────────────────▼────────────────────────────────┐
│                        CONTROL PLANE                          │
│   Identity · Policy · Risk · Limits · Compliance · Approvals  │
│                     Can allow or reject.                      │
└──────────────────────────────┬────────────────────────────────┘
                               │ authorized intent
┌──────────────────────────────▼────────────────────────────────┐
│                  FINANCIAL EXECUTION PLANE                    │
│      Ledger · Payments · Cards · Rails · FX · Settlement      │
│                    Execute and account.                       │
└───────────────────────────────────────────────────────────────┘
```

An LLM can never write to the ledger. It can only produce an **intent**, which a
deterministic policy engine classifies as `ALLOW`, `REQUIRE_APPROVAL` or `DECLINE`
— fail-closed. Amounts above an agent's approval threshold create a human approval
request. Every decision, execution and state change lands in a tamper-evident,
hash-chained audit trail.

This mirrors where the industry is heading: agentic payment systems keep intent
orchestration separate from deterministic authorization and settlement.

---

## 🖥️ Live Demo

```bash
bun install
bun run db:push            # apply the schema
bun prisma/seed.ts         # deterministic sandbox dataset through the REAL kernel
bun run dev                # http://localhost:3000
```

| | |
|---|---|
| **Dashboard login** | `demo@novera.africa` / `novera-demo-2026` (or the one-click demo button) |
| **API key (TEST)** | `nv_test_demo0001secret` |
| **Agent credential** | Atlas the procurement agent — `nv_agent_procure01secret` |

**Worth trying first:**
1. **Dashboard** → cash position, split-rule waterfall, live ops glance.
2. **Agents → Atlas** → use the *intent simulator* to propose a KES 40,000 payment:
   the deterministic policy gate escalates it to the human approval queue.
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

> **Honesty by design:** this is a sandbox reference build. All providers are
> deterministic TEST simulators (clearly labeled `TEST MODE` in the UI), no real
> funds move, and pending funds are never displayed as available. See
> [ADR-0004](docs/ARCHITECTURE_DECISIONS.md).

### Screenshots

| | |
|:---:|:---:|
| ![Landing](docs/assets/landing.png) | ![Dashboard](docs/assets/dashboard.png) |
| *Landing — the three-plane story* | *Dashboard — cash position, split waterfall, agentic activity* |
| ![Agents](docs/assets/agents.png) | ![Ledger](docs/assets/ledger.png) |
| *Know-Your-Agent registry with policy gates* | *Double-entry explorer with per-currency trial balance* |

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

- **The ledger is the source of truth.** Balances are always *derived* from
  immutable entries — never stored, never cached.
- **Providers are rails, not truth.** M-Pesa, banks, cards and USDC sit behind one
  provider abstraction; reconciliation compares the providers' own statements
  against the ledger, and discrepancies become operator cases (nothing auto-repairs).
- **Full docs:** [`docs/architecture/`](docs/architecture/overview.md) ·
  [ADRs](docs/ARCHITECTURE_DECISIONS.md) · [Security](docs/security/overview.md) ·
  [Runbooks](docs/runbooks/)

---

## 💰 The Financial Kernel

The kernel is the most important component in Novera, and it is *real* — not
decorated CRUD. Verified properties:

| Invariant | Enforcement |
|---|---|
| `SUM(debits) = SUM(credits)` — per currency | Validated before every post; provable after via `trialBalance()` |
| Posted records are immutable | No update/delete path exists; corrections are **reversal-only** mirror transactions |
| Balances derive from entries | `accountBalance()` aggregates entries at read time (includes reversal netting) |
| Every money-mutation is idempotent | Idempotency keys on postings, settlements, refunds, agent executions |
| Money is never a float | `@novera/money`: BigInt minor units + currency table; `KES + USD` throws |
| Allocation never leaks units | Largest-remainder `allocateBps()` — parts sum *exactly* to the source |
| The audit trail is tamper-evident | `sha256(prevHash ‖ canonical)` hash chain; `verifyAuditChain()` recomputes it |
| FX respects minor-unit scales | Two single-currency postings through FX clearing; scale-aware conversion |

Posting semantics (from the code, not aspiration):

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
tests/money.test.ts              30 passing   (allocation exactness ×50 randomized cases)
tests/policy.test.ts             18 passing   (fail-closed, boundaries, determinism ×100)
tests/fx.test.ts                 14 passing   (scaled rates, cross-currency minor units)
tests/ledger.invariants.test.ts  20 passing   (balance, idempotency, reversal, trial balance)
tests/payments.invariants.test.ts 7 passing   (settlement legs, refund netting, replay safety)
```

The seed itself is a proof: ~200 payments, splits, transfers, card authorizations,
an FX conversion, agent executions and refunds are all driven **through the real
kernel services** — the demo data *is* the integration test. After seeding:
per-currency trial balance balanced, audit chain 818/818 valid, no negative balances.

---

## 🤖 Agentic Finance (Know Your Agent)

Every AI agent is a first-class, governed financial actor:

```text
Agent (identity + hashed credential, shown once)
  → Intent (LLM proposal — untrusted until validated)
  → Deterministic policy (per-txn ceiling, daily ceiling, approval threshold, scopes)
  → ALLOW → ledger  |  REQUIRE_APPROVAL → human queue  |  DECLINE → denied + audited
```

- **Atlas** (procurement): pays ≤ KES 45,000/txn, ≤ KES 150,000/day; anything above
  KES 30,000 requires human approval. Watch it get *policy-denined* at KES 220,000.
- **Meridian** (treasury): read-only. Cannot move money at all.
- Scopes, merchant allowlists, revocation, per-agent wallets, full intent audit.

The copilot answers questions only through deterministic, org-scoped query tools —
with a visible **provenance chip** (`GROUNDED` / `ESTIMATED` / `UNKNOWN`) on every
answer. It never fabricates figures; projections are labeled as projections.

---

## 🧩 Product Surface

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

Replaying the same `idempotencyKey` returns the **same payment** — one financial
effect, always. Keys are stored as SHA-256 hashes (secret shown once), rate-limited
per key, and every request is logged (redacted) for the portal's request-log viewer.
Webhooks are HMAC-SHA256-signed with retry/dead-letter status and manual replay.
Live OpenAPI document: `GET /api/v1/openapi.json`.

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
│       ├── (app)/       # 24 dashboard routes (wallets → developers)
│       ├── (auth)/      # login / register
│       ├── pay/[token]/ # public hosted checkout
│       └── api/v1/      # public REST API (10 endpoint groups + OpenAPI)
├── prisma/              # schema (30 models) + kernel-driven deterministic seed
├── tests/               # 89 invariant tests (vitest)
├── docs/                # architecture, security, runbooks, ADRs, API notes
└── .github/workflows/   # CI: typecheck → lint → db push → invariant tests
```

**Reference build → production path** (see [ADRs](docs/ARCHITECTURE_DECISIONS.md)):
this repo is a TypeScript reference implementation that proves the model — the
kernel semantics, state machines and contracts map 1:1 to the production target:
Java 25/Spring kernel, Go provider gateways, Python intelligence services,
PostgreSQL 18 as source of truth, NATS JetStream events, Temporal workflows,
OpenTelemetry observability.

---

## ✅ Quality Gates

- `bunx tsc --noEmit` — zero type errors
- `bun run lint` — clean
- `bun run test` — 89/89 invariant tests green
- Seed-verified: per-currency trial balance, audit hash chain, non-negative balances
- Route smoke: 24 app pages + detail pages + checkout + 10 API groups return 200
- Server-side authorization everywhere; every query org-scoped (IDOR-safe);
  every mutation audited

---

## 🚀 Getting Started

```bash
bun install
cp .env.example .env          # DATABASE_URL defaults to ./db/custom.db
bun run db:push               # apply schema
bun prisma/seed.ts            # deterministic dataset via the real kernel
bun run dev                   # → http://localhost:3000
bun run test                  # 89 invariant tests
```

Sign in with `demo@novera.africa` / `novera-demo-2026`. Contributions follow
[CONTRIBUTING.md](CONTRIBUTING.md) — the PR checklist mirrors the engineering
directive (ledger invariants, idempotency, security review, no fake finance).

<div align="center">

**Novera — every debit has a credit. Every AI action has a policy gate.
Every money movement has a story you can reconstruct.**

</div>
