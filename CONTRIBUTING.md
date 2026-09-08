# Contributing to Novera

Novera is programmable financial infrastructure: **AI proposes. Policy authorizes. The
ledger records.** Contributions are held to the standards the money path demands —
this file tells you how to set up, what the conventions are, and what every PR is
checked against.

Architecture context: [`docs/architecture/overview.md`](docs/architecture/overview.md) ·
decision log: [`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md) ·
API notes: [`docs/api/openapi-notes.md`](docs/api/openapi-notes.md).

## Development setup

Prerequisites: [Bun](https://bun.sh) (1.2+; local dev currently on 1.3.x), Node
compatibility provided by Bun itself.

```bash
# 1. Install dependencies
bun install

# 2. Point Prisma at a database (defaults are in .env)
#    DATABASE_URL=file:/<abs path>/db/custom.db
#    (SQLite relative URLs resolve against prisma/ for the CLI and against
#     CWD for the runtime — prefer absolute URLs; see tests/setup-env.ts)

# 3. Create/sync the schema
bun run db:push

# 4. Seed demo data THROUGH the real kernel
#    (login: demo@novera.africa / novera-demo-2026)
bun prisma/seed.ts

# 5. Run the dev server (port 3000)
bun run dev

# Sanity checks
bun scripts/verify-balances.ts   # per-currency trial balance + no negative wallets
bunx tsc --noEmit                # typecheck (must be zero errors)
bun run lint                     # eslint (must be clean)
```

CI runs the same gates on every push/PR — see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml): install → `tsc --noEmit` →
lint → Prisma schema push to a throwaway CI database → vitest.

## Project conventions

These are the rules reviews will actually enforce:

### Money

- **Integer minor units (`BigInt`) only.** Use `@novera/money`'s `Money` —
  `Money.fromMajor("1250.00", "KES")` for decimal input, `Money.fromMinor` for minor
  units. Never `parseFloat`/`Number` arithmetic on money; never store floats.
- **Currency-qualified always.** `Money.add` throws on currency mismatch — keep it that way.
- **Allocation** (splits, refunds) goes through `Money.allocateBps` (largest-remainder;
  parts sum exactly). Do not hand-roll percentage math.
- **At the client boundary, BigInt becomes a string**: server pages map rows to
  `amountMinor: x.amountMinor.toString()`; client components render via
  `<MoneyText minor={…} currency={…} />`. Raw `BigInt` is not JSON-serializable.
- **Never sum across currencies.** Group KPIs per currency.

### Ledger & state

- **All money movement goes through `@/lib/ledger`'s `postTransaction`** — balanced,
  org-scoped, idempotent. Never write `LedgerEntry` rows directly.
- **Idempotency keys on every money-changing operation** (unique constraint is the
  backstop; check-before-write is the fast path).
- **Corrections are reversal-only.** No updates/deletes on posted transactions.
- **State machines come from `@novera/domain`** (`canTransitionPayment`,
  `CARD_TRANSITIONS`, …) — never hand-roll a transition, never bypass a guard.
- **Honesty:** a `PROCESSING` payment is never rendered settled; pending funds are
  never shown as available; unknown values render "—"; sandbox rails stay labeled
  TEST everywhere. No fake finance, ever.

### Security

- **Server-side authorization only.** Start every page/action with
  `requireSession()`; API handlers go through `withApiKey()`. Never trust the client.
- **Every query is org-scoped** from the session/key —
  `findFirst({ where: { id, organizationId } })` for URL ids (IDOR protection).
- **Every mutation calls `recordAudit()`** (via kernel services or directly) — no
  silent writes.
- Secrets (API keys, agent credentials, webhook secrets) are hashed at rest and shown
  once — see [`docs/security/overview.md`](docs/security/overview.md).

### UI

- **shadcn/ui + shared Novera primitives** (`PageHeader`, `KpiCard`, `MoneyText`,
  `StatusBadge` family, `EmptyState`, `CopyButton`, `CodeBlock`) — never re-invent.
- **Dark-first, semantic tokens** (`bg-card`, `text-muted-foreground`,
  `border-border`, `text-primary`) — no raw hex, no indigo/blue accents.
- Server components by default; `'use client'` only where interactivity demands it.
  Server actions co-located in `actions.ts` with `'use server'`.
- Standard index-page composition: KPI row → chart → table → side context. Detail
  pages: header + status badge + facts grid + timeline + related records.
- Responsive, accessible, `loading.tsx` skeletons for list pages; toasts for action
  feedback; touch targets ≥ 36px.

### Testing

- Kernel invariants are tested under `tests/` (vitest, single-fork pool, dedicated
  `db/test.db` — the suite bootstraps itself via `tests/global-setup.ts`).
- Run locally: `bunx vitest run`.
- New money-path code should extend the invariant suite: per-currency balance,
  idempotent replay, reversal-only corrections, org scoping.

## PR checklist

Mirror of the engineering directive — a reviewer will ask for every one of these:

**Ledger invariants**
- [ ] New postings pass `postTransaction` (≥ 2 entries, positive amounts, per-currency
      Dr = Cr) — no direct `LedgerEntry` writes.
- [ ] `bun scripts/verify-balances.ts` green; `/transactions` trial balance green;
      `/audit` chain valid.
- [ ] Corrections are reversal-only; posted rows untouched.

**Idempotency**
- [ ] Every money-changing operation (new endpoints/actions included) carries an
      idempotency key; replay returns the original result with no new side effects.
- [ ] Double-submit (concurrent or sequential) cannot move money twice — balance
      checks happen inside the posting transaction.

**Security review**
- [ ] Authorization is server-side; org scoping on every query (no IDOR: foreign ids
      404, cross-org ledger accounts rejected).
- [ ] No secrets/secrets-bearing data to the client; request bodies with
      secret-ish fields are redacted in logs.
- [ ] Every mutation audited (`recordAudit`); error messages don't leak tenancy.
- [ ] LLM/agent surfaces: proposals only — deterministic policy still decides; no new
      path from model output to `postTransaction`.
- [ ] Red-team checklist spot-check for the feature's attack surface
      ([`docs/security/overview.md §6`](docs/security/overview.md)).

**Hygiene**
- [ ] `bunx tsc --noEmit` zero errors · `bun run lint` clean.
- [ ] Money via `Money`/`MoneyText`; BigInt → string at boundaries; no floats.
- [ ] UI: dark-first tokens, responsive, a11y (labels, aria, focus), loading/empty
      states, toasts.
- [ ] Docs updated if you changed architecture, API surface, or a runbook
      ([`docs/`](docs/) is the source of truth, not marketing).

## Incident & operations

If your change affects how operators respond to incidents, update the relevant runbook:
[`docs/runbooks/ledger-discrepancy.md`](docs/runbooks/ledger-discrepancy.md),
[`docs/runbooks/provider-outage.md`](docs/runbooks/provider-outage.md),
[`docs/runbooks/security-incident.md`](docs/runbooks/security-incident.md).

## Style notes

- TypeScript strict; ES modules; path aliases `@/*` and `@novera/*`.
- Comments explain *why* (invariants, honesty rules), especially in `src/lib`.
- Commit messages: imperative, specific ("fix: renormalized split percentages drained
  Operating", not "fixes").
