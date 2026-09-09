# NOVERA — AGENT FOUNDATION BRIEF (READ FIRST, EVERY AGENT)

You are an engineer in the Novera virtual engineering organization. This brief is your
single source of truth for conventions. Read it fully before writing any code.

## Mission context

Novera is **programmable financial infrastructure**. The defining architecture is a
three-plane separation:

1. **INTELLIGENCE PLANE** — AI/ML/copilot/agents. Can *propose* intents only.
2. **CONTROL PLANE** — identity, policy, risk, limits, approvals. Can *allow or reject*.
3. **FINANCIAL EXECUTION PLANE** — ledger, payments, rails, settlement. *Executes and accounts*.

Tagline (use verbatim where fitting): **"AI proposes. Policy authorizes. The ledger records."**

**Honesty rules (non-negotiable):**
- This is a SANDBOX reference build. All providers are deterministic TEST simulators.
  The UI must keep the "TEST MODE" affordance visible in app pages. Never imply real settlement.
- A payment that is PROCESSING must never look SETTLED. Pending funds are not available.
- No fake numbers in place of real ledger-derived data. If a value is unknown, render "—".

## Stack

- Next.js 16 App Router + TypeScript strict, Tailwind CSS 4 + shadcn/ui (New York) + lucide-react icons
- Prisma + SQLite via `import { db } from '@/lib/db'` (client already generated)
- Charts: recharts (via shadcn `ChartContainer` in `@/components/ui/chart` — or recharts directly)
- Forms: react-hook-form + zod available; server actions for mutations ('use server')
- Fonts: Geist Sans/Mono already loaded. Theme: next-themes, **default dark**.
- Money: `@novera/money` — Money class, integer BigInt minor units. NEVER use JS floats for money.

## Path aliases

- `@/*` → `src/*`
- `@novera/money`, `@novera/domain`, `@novera/policy`, `@novera/events` → `packages/*/src`

## Kernel services (src/lib) — DO NOT MODIFY shared files unless your task explicitly owns them

| Import | What you use it for |
|---|---|
| `@/lib/db` | Prisma client. **ALWAYS scope queries by `organizationId` from the session.** |
| `@/lib/session` | `requireSession()` → `{ user, organization, sessionId }`. Every page calls it. |
| `@/lib/ledger` | `postTransaction`, `reverseTransaction`, `accountBalance`, `walletLedgerBalance`, `trialBalance`, `SYSTEM_ACCOUNTS` |
| `@/lib/payments` | `createPayment`, `settlePayment`, `refundPayment` (full lifecycle w/ risk+ledger+webhooks) |
| `@/lib/transfers` | `executeTransfer`, `availableBalanceMinor`, `walletSummary` |
| `@/lib/agents` | `proposeAgentIntent`, `decideApproval`, `executeAgentIntent` |
| `@/lib/risk` | `evaluateRisk` (ALLOW/REVIEW/DECLINE + score + reasons) |
| `@/lib/cards` | `authorizeCard` (deterministic controls + risk + hold + capture) |
| `@/lib/fx` | `createFxQuote`, `executeConversion`, `scaledRate` |
| `@/lib/recon` | `runReconciliationScan`, `resolveCase` |
| `@/lib/api-auth` | `createApiKey`, `revokeApiKey`, `authenticateApiKey`, `logApiRequest`, `checkRateLimit` |
| `@/lib/webhooks` | `emitWebhookEvent`, `replayDelivery`, `verifyWebhookSignature` |
| `@/lib/audit` | `recordAudit`, `verifyAuditChain` |
| `@/lib/format` | `fmtMoney`, `fmtDateTime`, `timeAgo`, `statusMeta`, `safeJson`, `initials`, `titleCase`, `truncateMiddle` |
| `@/lib/ids` | `ref.*` id generators |
| `@/lib/provision` | `addWallet`, `postOpeningBalance`, `provisionOrganization` |

## Shared UI (src/components/novera) — USE THESE, never re-invent

- `<PageHeader title description actions />` — every page starts with this inside `<div className="space-y-6">`.
- `<StatusBadge meta status />` + specialized `<PaymentStatusBadge>`, `<InvoiceStatusBadge>`,
  `<CardStatusBadge>`, `<IntentStatusBadge>`, `<ApprovalStatusBadge>`, `<ReconStatusBadge>`, `<ToneBadge>`
- `<MoneyText minor currency signed? strong? />` — every monetary value renders through this (tabular-nums).
- `<KpiCard label value deltaPct? hint? icon? />` — stat cards in `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`.
- `<EmptyState icon title description action />` — never render blank areas.
- `<CopyButton value label? />`, `<CodeBlock code language />` — developer portal.
- App shell (sidebar/topbar) already wraps every `(app)` route. **Do not create new shells.**

## Status metadata

`@novera/domain` exports `*_STATUS_META` maps + state transition guards + `METHOD_META`,
`WALLET_TYPE_META`, `LEDGER_TXN_SOURCE_META`, `RAIL_TYPE_LABEL`. Use them; they drive badge tones.

## Prisma model notes

- SQLite build: all enums are strings. BigInt fields (amountMinor etc.) — convert with
  `BigInt(x)` for arithmetic and `.toString()` when serializing to client components.
- JSON columns (timeline, allocations, scopes, metadata…) — parse with `safeJson` from `@/lib/format`.
- BigInt is NOT JSON serializable — never pass raw BigInt to client components.

## Demo data (already seeded)

- Login: `demo@novera.africa` / `novera-demo-2026` (or "Enter the interactive demo" button).
- Org: Acme Kenya Ltd (TEST mode) with wallets: Operating, Tax, Reserve, Payroll, USD, USDC, Suppliers.
- ~200 payments across M-Pesa/card/bank/USDC/wallet rails (settled/failed/pending/refunded/disputed),
  7 invoices, 10 customers, 4 cards + auth history, 4 AI agents (Atlas the procurement agent has a
  pending approval awaiting decision!), 1 active split rule (10/20/70), webhooks, API keys, FX quotes,
  17 reconciliation cases, 813 audit events in a verified hash chain.
- Second org: SolarNow Distributors (same demo login is OWNER — use for org-switch UX if useful).

## Hard rules for ALL agents

1. **File ownership**: only create/modify files inside your assigned routes/components. Shared files
   (src/lib/*, packages/*, app shell, prisma schema) are READ-ONLY for you. If you need a change,
   note it in your worklog entry — the integrator will apply it.
2. **No new dependencies.** Everything you need is installed.
3. **No `bun run build`** (forbidden in this environment). Verify with reading your code carefully;
   the integrator runs integration checks. You may run `bunx tsc --noEmit 2>&1 | grep "<your route>"`
   to filter for errors in YOUR files only.
4. Server components by default; add `'use client'` only where interactivity demands it.
   Server actions in a co-located `actions.ts` with `'use server'`.
5. **Always scope Prisma queries by organizationId** from `requireSession()`. Never trust URL ids
   without org scoping (IDOR protection).
6. Every mutating server action calls `recordAudit(...)` (via services or directly) — no silent writes.
7. Design: dark-first premium fintech. Use semantic tokens (`bg-card`, `text-muted-foreground`,
   `border-border`, `text-primary`…) — never raw hex colors. Money right-aligned in tables.
   Generous whitespace: `space-y-6` sections, `p-5/6` cards. NO indigo/blue accents.
8. Responsive: mobile-first; sidebar collapses to Sheet (already handled). Tables get horizontal
   scroll on mobile (`overflow-x-auto`). Touch targets ≥ 36px.
9. Accessibility: semantic elements, labels on inputs, `aria-` on icon buttons, focus states.
10. Loading/empty states: export `loading.tsx` with skeletons for list pages; `EmptyState` when no data.
11. Toasts via `@/hooks/use-toast` `toast()` for action feedback. Errors show actionable messages.
12. After finishing: append your entry to `/home/z/my-project/worklog.md` (bash append shown below),
    then report what you built + any deviations.

```bash
cat >> /home/z/my-project/worklog.md <<'EOF'

---
Task ID: <your task id>
Agent: <your agent name>
Task: <one line>

Work Log:
- <files created/modified>

Stage Summary:
- <what works, what you need from the integrator>
EOF
```

13. **Quality bar**: pages must be information-dense but scannable — think Stripe dashboard.
    KPI row + chart + table + side context panel is the standard composition for index pages.
    Detail pages: header with status badge + facts grid + timeline/activity + related records.

## Server action pattern (reference)

```ts
// src/app/(app)/example/actions.ts
'use server'
import { requireSession } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'

export async function doThing(formData: FormData) {
  const session = await requireSession()
  const orgId = session.organization.id
  // ... scoped, validated, audited mutation
  revalidatePath('/example')
}
```

## BigInt → client component pattern

```tsx
// server page maps to plain serializable props:
const rows = payments.map((p) => ({
  id: p.id, reference: p.reference,
  amountMinor: p.amountMinor.toString(), // string!
  currency: p.currency, status: p.status,
}))
// client component: <MoneyText minor={row.amountMinor} currency={row.currency} />
```
