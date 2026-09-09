#!/usr/bin/env bash
# Novera audit → GitHub issues. Run once. Creates one issue per material finding.
set -euo pipefail
cd /home/z/my-project

create() { # create <labels> <title> <body-file>
  gh issue create --label "$1" --title "$2" --body-file "$3" | tail -1
}

# ---------- Issue 1: Kernel balance enforcement ----------
cat > /tmp/i1.md <<'EOF'
### Problem
Only `executeTransfer` verifies available funds. Three money paths post wallet-crediting entries with **no balance guard**: outbound payment settlement (`src/lib/payments.ts` settlePayment, direction=OUT), FX conversion (`src/lib/fx.ts` executeConversion — credits source wallet with proceeds while debiting spent currency), and card capture (`src/lib/cards.ts` captureAuthorization — credits the card wallet).

### Context
The README/docs promise "no negative balances" and `scripts/verify-balances.ts` logs FAIL on negative balances — but nothing in the kernel enforces it on these paths. A wallet asset account can go negative, violating a stated financial invariant.

### Scope
- Add a kernel-level available-balance guard (inside the posting transaction) for every wallet-debit path.
- Apply to settlePayment (OUT), executeConversion, captureAuthorization.

### Out of Scope
- Transfer path (separate issue: transaction isolation).
- UI-side pre-checks (already exist for FX, non-authoritative).

### Acceptance Criteria
- [ ] Kernel test: settlement of an outbound payment exceeding wallet funds throws `InsufficientFunds` and posts nothing.
- [ ] Kernel test: FX conversion with insufficient source balance throws.
- [ ] Kernel test: card capture exceeding wallet funds throws.
- [ ] All 89 existing invariant tests still pass.

### Testing
New vitest cases in `tests/payments.invariants.test.ts` + `tests/fx.test.ts` + ledger balance tests.

### Rollback
Single revert commit; no schema change.
EOF
create "P1,kernel" "Kernel: enforce available-balance checks on payouts, FX conversion and card capture" /tmp/i1.md

# ---------- Issue 2: Refund replay ----------
cat > /tmp/i2.md <<'EOF'
### Problem
`refundPayment` (`src/lib/payments.ts:355-416`): when a retry replays an idempotent refund, `postTransaction` correctly returns the existing posting, but the code still executes `refundedMinor = alreadyRefunded + amountMinor` and re-emits `payment.refunded`. A double-submit of a 50% refund sets `refundedMinor` to 100% and flips status to REFUNDED while the ledger only moved half.

### Context
This is the one path where an ordinary user retry corrupts financial state: `refundedMinor` diverges from the ledger. Breaks the "payment state always mirrors the ledger" contract.

### Scope
- Detect idempotent replay (posting already existed) and short-circuit before the `refundedMinor` update and webhook emission.

### Acceptance Criteria
- [ ] Test: calling refundPayment twice with identical (paymentId, amountMinor) yields `refundedMinor == amountMinor` (not 2×) and one `payment.refunded` event.
- [ ] Existing refund netting tests still pass.

### Testing
New case in `tests/payments.invariants.test.ts` (replay safety family).

### Rollback
Single revert commit.
EOF
create "P1,kernel" "Kernel: refund retry double-counts refundedMinor and diverges from the ledger" /tmp/i2.md

# ---------- Issue 3: Transfer double-spend race ----------
cat > /tmp/i3.md <<'EOF'
### Problem
`executeTransfer` (`src/lib/transfers.ts:71-78`): the available-balance read runs **outside the posting transaction** — `availableBalanceMinor` uses the global `db` client, not the transaction client. Two concurrent transfers draining one wallet can both pass the check. The doc comment claims the check is "inside the same transaction" (`transfers.ts:11-13`, `docs/architecture/financial-kernel.md` §3).

### Context
Documented guarantee is not actually implemented. Under concurrency, funds can be double-spent — the classic financial-kernel failure mode.

### Scope
- Pass the transaction client into the balance read (or a conditional posting) so the check is serialized with the posting.

### Acceptance Criteria
- [ ] Balance check executes inside the same Prisma transaction as the posting (code inspection).
- [ ] A serialized double-spend test: two sequential transfers totalling > balance → second throws.
- [ ] Docs updated to describe the actual mechanism.

### Rollback
Single revert commit.
EOF
create "P1,kernel" "Kernel: transfer balance check is outside the posting transaction (double-spend race)" /tmp/i3.md

# ---------- Issue 4: FX quote amount binding ----------
cat > /tmp/i4.md <<'EOF'
### Problem
`FxQuote` never persists the quoted amount. `executeConversion` (`src/lib/fx.ts:98-117`) accepts any caller-supplied `amountMinor` at the locked rate. Status/expiry are checked, so double-settlement is prevented — but one quote can settle an arbitrary size, and the kernel performs no balance check (the dashboard action does, non-transactionally → TOCTOU).

### Context
A locked quote is meant to be a contract: rate + amount + expiry. Amount-free quotes make "locked quote" semantics decorative and let the dashboard's non-transactional pre-check be raced.

### Scope
- Persist `amountMinor` (and currency pair already present) on `FxQuote`.
- `executeConversion` rejects executions whose amount ≠ quoted amount (422-class domain error).
- Kernel-side available-balance check (ties into balance-guard issue).

### Acceptance Criteria
- [ ] Test: settling a quote with a different amount than quoted throws.
- [ ] Test: settling the quoted amount twice → second throws (already partially covered).
- [ ] Existing FX tests updated to the new quote flow.

### Rollback
Revert + `prisma db push` rollback (schema field addition only).
EOF
create "P1,kernel" "Kernel: FX execution amount is not bound to the quote" /tmp/i4.md

# ---------- Issue 5: Idempotency hardening ----------
cat > /tmp/i5.md <<'EOF'
### Problem
`POST /api/v1/payments` idempotency has two holes:
1. **Replay with different body** (`payments/route.ts:130-139`): same `idempotencyKey`, different parameters → silently returns the original payment (200). Standard semantics (Stripe): 422 with `idempotency_error`.
2. **Concurrent duplicate** (`payments/route.ts:154-160` + `payments.ts:96-118`): both requests pass the pre-check; the second `create` throws Prisma P2002, escapes the catch → **500 INTERNAL** instead of 200-replay.

### Context
Idempotency is a headline feature of the developer platform ("one financial effect, always"). A 500 on a legitimate concurrent retry and a silent wrong-object 200 both violate the documented contract.

### Scope
- Store a request fingerprint with the payment (sha256 of canonical body).
- On replay: fingerprint match → return original; mismatch → 422 `idempotency_error`.
- Catch P2002 in the creation path → re-read and return the original payment.

### Acceptance Criteria
- [ ] Test: replay same key+body → 200 same payment.
- [ ] Test: replay same key+different amount → 422.
- [ ] Test: two concurrent creates with same key → both 200, one payment, one ledger effect.

### Rollback
Revert (schema: add optional `idempotencyFingerprint String?` — backward compatible).
EOF
create "P2,api" "API: harden payment idempotency (body-mismatch 422 + P2002 race 500)" /tmp/i5.md

# ---------- Issue 6: SSRF guard ----------
cat > /tmp/i6.md <<'EOF'
### Problem
Webhook endpoint registration (`api/v1/webhooks/endpoints/route.ts:49-57`, `developers/webhooks/actions.ts:36-44`) validates URL format and HTTPS only. `https://169.254.254.169/latest/meta-data`, `https://localhost`, and RFC1918 hosts are accepted and stored. Not currently exploitable (delivery is simulated, zero `fetch()` in src/lib) — but it is a live latent SSRF the moment real HTTP delivery lands.

### Context
Cheap to fix now, catastrophic to forget later. Standard supply for any webhook system.

### Scope
- At registration (both API + dashboard action): parse hostname; reject loopback, link-local (169.254/16, fe80::/10), unique-local (fc00::/7), RFC1918 (10/8, 172.16/12, 192.168/16), `localhost`, `0.0.0.0`, and non-443/non-standard ports? (keep: any port allowed, IP-range rejection only).
- Document the policy in openapi-notes.

### Acceptance Criteria
- [ ] Test: `https://localhost/hook`, `https://169.254.169.254/x`, `https://192.168.1.5/hook` rejected with 422 and a clear message.
- [ ] Test: `https://example.com/hook` accepted.
- [ ] DNS-resolving hostnames checked post-resolution (reject hostnames that resolve into private ranges).

### Rollback
Single revert commit.
EOF
create "P2,security" "Security: SSRF guard for webhook endpoint URLs (private/loopback/link-local rejection)" /tmp/i6.md

# ---------- Issue 7: Session hardening ----------
cat > /tmp/i7.md <<'EOF'
### Problem
Two auth-layer weaknesses:
1. **Session tokens stored plaintext** in the `Session` table (`db.session.findUnique({ where: { token } })`). API keys are correctly stored as SHA-256 hashes — sessions are not. A read-only DB leak becomes replayable sessions.
2. **Login has no throttle** and **leaks registered emails via timing** (`loginUser`: `findUnique` returns instantly for unknown email, scrypt only runs for existing users).

### Context
Reference build, but auth patterns get copied. Hashing session tokens costs one line at create/lookup. A simple in-memory failed-login throttle (per email+IP, 5 tries / 15 min) plus a dummy-hash verification on unknown email closes both holes.

### Scope
- Store `sha256(token)` in `Session.tokenHash`; look up by hash; keep raw token only in the cookie.
- In-memory failed-login limiter (same pattern as the API rate limiter).
- Constant-time path: verify against a fixed dummy hash when the user is not found.
- Log failed key-auth attempts in `api-auth.ts` 401 path (currently unlogged).

### Acceptance Criteria
- [ ] Existing sessions continue to work after re-login (seed updates if it creates sessions).
- [ ] Test: 6 consecutive bad logins → 429-class error on the 6th.
- [ ] Unknown-email and wrong-password login take approximately equal time.

### Rollback
Single revert + re-login.
EOF
create "P2,security" "Security: hash session tokens at rest + login throttle + enumeration timing" /tmp/i7.md

# ---------- Issue 8: Checkout throttle ----------
cat > /tmp/i8.md <<'EOF'
### Problem
Public payment creation on `/pay/[token]` (`src/app/pay/[token]/actions.ts:39-84`) is unauthenticated and unthrottled: bots can flood payments, risk evaluations, audit events and webhook deliveries per link token. Custom-amount links accept unbounded amounts.

### Context
Public hosted checkout is by definition an internet-facing form. Needs per-token/IP rate limiting and a sane max amount.

### Scope
- Reuse the in-memory rate limiter: N attempts per token+IP per window.
- Cap custom amount at the link's own max (or a platform ceiling) server-side.

### Acceptance Criteria
- [ ] Test/inspection: >N submissions per window from same IP+token → 429-style `{ok:false,error}` surfaced as toast.
- [ ] Custom amount above cap → rejected server-side with clear message.

### Rollback
Single revert commit.
EOF
create "P2,security" "Security: rate-limit public checkout submissions and cap custom amounts" /tmp/i8.md

# ---------- Issue 9: Audit chain fork ----------
cat > /tmp/i9.md <<'EOF'
### Problem
`recordAudit` (`src/lib/audit.ts:50-54`) does read-last-hash → create with no serialization. Two concurrent events read the same `prevHash` and the chain forks; `verifyAuditChain` then reports a tamper break on a benign concurrent write.

### Context
The hash chain is a headline integrity feature ("tamper-evident, recomputable"). A false tamper alarm from ordinary concurrency destroys operator trust in it.

### Scope
Serialize the read-last + create inside a single transaction with a row lock (SQLite: `BEGIN IMMEDIATE` semantics via `$transaction` with isolation level, or an application-level mutex since this is a single-process reference build).
PostgreSQL production target: advisory lock documented in ADR.

### Acceptance Criteria
- [ ] Test: fire N concurrent `recordAudit` calls → chain verifies valid, no fork.
- [ ] Existing 818-event seeded chain still verifies.

### Rollback
Single revert commit.
EOF
create "P2,kernel" "Kernel: audit hash chain can fork under concurrent appends" /tmp/i9.md

# ---------- Issue 10: Webhook realism ----------
cat > /tmp/i10.md <<'EOF'
### Problem
Three related gaps in the webhook subsystem:
1. `emitWebhookEvent` only writes simulated `WebhookDelivery` rows — **no HTTP delivery exists** (zero fetch in src/lib), but `docs/api/openapi-notes.md` §5 and the OpenAPI description read as real delivery ("receives POSTs", "retries and dead-letter").
2. No delivery worker processes PENDING/next-attempt rows — `nextAttemptAt` is recorded fiction.
3. 11 of the events in `packages/events` catalog are subscribable but never emitted anywhere (`wallet.created`, `payment.created`, `payment.authorized`, `payment.processing`, `ledger.transaction.posted/reversed`, `card.created`, `agent.intent.proposed`, `invoice.issued`, `risk.review.created`, `reconciliation.mismatch.detected`).

### Context
Integrator-facing docs must not promise what does not ship. For the reference build: keep simulation, label it honestly, stop selling dead events.

### Scope
- openapi-notes + OpenAPI description: state plainly "delivery is simulated in TEST mode — no HTTP calls are made; retries/dead-letter states are modeled."
- Mark not-yet-emitted events in the events catalog (or wire the trivial ones: payment.created/authorized/processing, wallet.created).
- Webhook endpoints: add delete/disable (ties to frontend issue — dashboard cannot remove a leaked endpoint today).

### Acceptance Criteria
- [ ] openapi.json + notes say "simulated".
- [ ] Every event in the catalog is either emitted or explicitly marked `emitted: false` with a note.
- [ ] Endpoint delete/disable works with confirm dialog + audit.

### Rollback
Docs: revert freely. Catalog flags: additive.
EOF
create "P2,api,docs" "Webhooks: simulated delivery must be labeled; dead events and unmanageable endpoints" /tmp/i10.md

# ---------- Issue 11: Error boundaries ----------
cat > /tmp/i11.md <<'EOF'
### Problem
Zero `error.tsx` boundaries exist in the entire app. Any server-component exception (DB blip, Prisma timeout) renders Next's unbranded default error screen, dropping the app shell with no retry affordance.

### Context
The only systemic state-handling hole in an otherwise polished UI: loading and empty states are near-ubiquitous, but the error leg of the triad is missing.

### Scope
- `src/app/(app)/error.tsx` (in-shell, branded, "Try again" → `reset()`).
- Root `error.tsx` + `global-error.tsx`.
- Detail-route `not-found.tsx` for payments/[id], cards/[id], invoices/[id], agents/[id] (wallets/[id] already has one — reuse its pattern; add a root not-found too).

### Acceptance Criteria
- [ ] Forcing a render error shows the branded boundary, not the Next default.
- [ ] Deep-linking a bogus payment id shows the branded 404 inside the shell.

### Rollback
Additive files — delete to revert.
EOF
create "P1,frontend" "Frontend: no error boundaries — unbranded crash screen on any server exception" /tmp/i11.md

# ---------- Issue 12: loading parity ----------
cat > /tmp/i12.md <<'EOF'
### Problem
Data-heavy detail routes have no `loading.tsx`: `/cards/[id]`, `/invoices/[id]`, `/wallets/[id]`, `/copilot`, `/developers`, `/developers/docs`. In-app navigation freezes the previous screen until the new page streams. All 19 list routes and `agents/[id]`, `payments/[id]` have them — these five are the parity gap.

### Context
Perceived performance and consistency: the skeleton pattern already exists — copy it.

### Scope
Add `loading.tsx` (existing skeleton pattern) to the five route dirs.

### Acceptance Criteria
- [ ] Navigating to each of the five routes shows a skeleton, not a frozen previous page.

### Rollback
Additive files.
EOF
create "P1,frontend" "Frontend: missing loading.tsx on 5 detail routes (cards, invoices, wallets, copilot, developers)" /tmp/i12.md

# ---------- Issue 13: Settings stub ----------
cat > /tmp/i13.md <<'EOF'
### Problem
`/settings` (`src/app/(app)/settings/page.tsx:9-11`) is a dashed-border placeholder ("Module in active build — agent squad dispatching") while the account dropdown AND the sidebar nav both link to it — a dead-end journey for every user.

### Context
A visible stub is worse than no route: it signals unfinished work to the investors/recruiters the README targets. Ship the minimum honest version.

### Scope
Minimal real settings: organization name + country (read-only or editable with audit), members list with roles, session info, TEST-mode banner. No feature stubs.

### Acceptance Criteria
- [ ] /settings renders real org data for the demo org.
- [ ] No "in active build" copy remains anywhere in the product.

### Rollback
Single revert.
EOF
create "P2,frontend" "Frontend: /settings is a visible stub page linked from main nav" /tmp/i13.md

# ---------- Issue 14: Money-action confirmations ----------
cat > /tmp/i14.md <<'EOF'
### Problem
"Approve & execute" (`approval-card.tsx:243-269`) and "Approve & settle" (`review-queue.tsx:142-151`) move real ledger money on a single click with no confirmation — inconsistent with terminate-card, revoke-agent, cancel-invoice and archive-link, which all demand AlertDialog confirms (decline in risk review already has one).

### Context
Highest-consequence actions in the product have the least friction. A mis-click executes an agent intent or settles a held payment instantly.

### Scope
Wrap both approve buttons in an AlertDialog summarizing amount + currency + requester + consequence. Keep decline as-is.

### Acceptance Criteria
- [ ] Approving an intent shows a confirm dialog stating amount and agent before execution.
- [ ] Same for risk-review settle.

### Rollback
Single revert.
EOF
create "P2,frontend" "Frontend: single-click money-moving approvals need confirmation dialogs" /tmp/i14.md

# ---------- Issue 15: frontend P2 batch ----------
cat > /tmp/i15.md <<'EOF'
### Problem
Four smaller frontend gaps found in audit:
1. Demo-login form (`login/page.tsx:107`, `(auth)/actions.ts:30-34`) has no error capture — a failed demo login surfaces as an unhandled server-action error, unlike LoginForm/RegisterForm which use `useActionState`.
2. Payments pagination (`payments/page.tsx:304-318`): `<Button asChild disabled><Link>` — `disabled` on an anchor is invalid and Tailwind `disabled:` doesn't match anchors, so boundary pages look clickable; audit page already has the correct `pointer-events-none opacity-50` pattern.
3. Webhook endpoint management: no delete/disable (tracked in webhook issue).
4. Checkout receipt uses `toLocaleTimeString('en-KE')` — varies by runtime ICU data; use the shared `@/lib/format` wrapper.

### Scope
Fix 1, 2, 4 (3 tracked separately). Also remove `autoFocus` on the login email input (a11y) and fix customers `<tr role="button">` nesting if cheap.

### Acceptance Criteria
- [ ] Failed demo login shows a friendly inline error.
- [ ] Disabled pagination links on boundary pages are visually and functionally inert.
- [ ] Checkout receipt timestamps render via the shared formatter.

### Rollback
Single revert.
EOF
create "P2,frontend" "Frontend: demo-login error capture, pagination disabled-anchor, checkout time format" /tmp/i15.md

# ---------- Issue 16: repo hygiene ----------
cat > /tmp/i16.md <<'EOF'
### Problem
Repository hygiene defects now live on the public repo:
1. `.env` is **tracked** in git (currently only DATABASE_URL — no secret, but the pattern is dangerous and README says `cp .env.example .env` while **no `.env.example` exists**).
2. `tool-results/` — 21 internal agent transcript files — are tracked and pushed (repo pollution visible to every reviewer).
3. ~300 files carry mode `100755` (committed in `e396f89`), including README.md, package.json, all .ts files. Executable-bit on non-scripts is noise.
4. `download/README.md` ("Here are all the generated files.") is tracked; `mini-services/.gitkeep` is an empty template leftover.
5. `scripts/gh-bin/` (local gh CLI binary) must never be committed.

### Context
Investors and recruiters review the repo file tree. Transcript files and a tracked .env are exactly the "accidental artifacts" the release checklist forbids.

### Scope
- `git rm --cached .env tool-results download/README.md mini-services/.gitkeep` (keep local .env working).
- Create `.env.example` (DATABASE_URL with relative default) — makes the README instruction true.
- `.gitignore`: add `.env`, `tool-results/`, `download/`, `mini-services/`, `scripts/gh-bin/`, `*.log`.
- Normalize modes: `find . -type f -name "*.ts" ... chmod 644` for all tracked non-script files; commit mode normalization.
- README: verify quickstart matches new .env.example.

### Acceptance Criteria
- [ ] `git ls-files` contains no .env, no tool-results, no download/, no mini-services.
- [ ] `git ls-files -s | grep 100755` returns only genuinely executable scripts (none expected).
- [ ] Fresh clone → `cp .env.example .env` → `bun run db:push && bun prisma/seed.ts` works.
- [ ] CI green.

### Rollback
Single revert commit (all additive/ignore changes).
EOF
create "P1,hygiene" "Repo hygiene: tracked .env without .env.example, tool-results pollution, file-mode noise" /tmp/i16.md

# ---------- Issue 17: docs accuracy ----------
cat > /tmp/i17.md <<'EOF'
### Problem
Docs describe guarantees the code does not implement — traps for the next engineer:
1. **Dangerous:** `docs/architecture/financial-kernel.md` §4 item 4 and ADR-0008 claim REVERSED transactions are *excluded* from balance aggregation. Code (`ledger.ts:286,333`) includes both POSTED and REVERSED — which is CORRECT (a reversal cancels its original only if both count). If anyone "fixes" the code to match the doc, every reversal double-applies and balances corrupt.
2. `overview.md:110` says "30-model schema" — it is 35.
3. `provider-rails.md:56` lists `CARD_MC` as seeded — seed creates 5 providers, no CARD_MC.
4. `security/overview.md:106` calls the rate limiter "sliding window" — it is a fixed 60s window.
5. FX clearing "nets to zero per currency" (financial-kernel.md:312, ADR-0005) — it retains an FX position per currency; only the global per-currency proof holds.

### Context
Documentation-as-code requires docs to describe behavior that exists. The REVERSED claim is a correctness landmine.

### Scope
Correct the five passages to describe actual behavior; note the production-target intent where relevant.

### Acceptance Criteria
- [ ] Each passage matches code behavior; REVERSED passage explains why both statuses must aggregate.

### Rollback
Docs revert.
EOF
create "P2,docs" "Docs: five claims contradict the code (REVERSED aggregation claim is dangerous)" /tmp/i17.md

# ---------- Issue 18: API robustness batch ----------
cat > /tmp/i18.md <<'EOF'
### Problem
API robustness gaps (batched):
1. `GET /api/v1/invoices` — unbounded `findMany`, no `take` (payments/transactions cap at 100).
2. `description` maxLength 500 declared in OpenAPI but unenforced in code (same: webhook URL length, events array size).
3. `ApiKey.keyHash` lacks `@unique` (findFirst works; no index/integrity). `WebhookEndpoint` lacks `(organizationId,url)` uniqueness at API layer (dashboard has a dupe guard).
4. Registration: email format never validated server-side; concurrent same-email register → P2002 → 500.
5. `replayDelivery` (webhooks.ts:103-125) — org scoping lives only in the caller; overwrites the stored signature with a fresh timestamp (history rewrite). Tighten scoping inside the service; keep the original signature.
6. Missing provider after AUTHORIZED (`payments.ts:186`) leaves the payment stuck in AUTHORIZED forever — fail it (FAILED + timeline) instead.
7. `health` returns static 200 — add a DB-probing readiness variant (keep liveness simple).
8. Stray scaffold route `src/app/api/route.ts` ("Hello, world!") — delete.
9. PENDING set via direct `db.payment.update` bypassing `transition()` (`payments.ts:171`) — route through the state machine.
10. Mixed-currency postings: `ledger.ts:115-119` sums header amount across currencies — reject mixed-currency transactions in `validateEntries`.

### Acceptance Criteria
- [ ] All ten items addressed; 89 invariant tests + new tests green; CI green.

### Rollback
Per-item reverts; schema changes are additive (unique index needs db push).
EOF
create "P2,api" "API: robustness batch (invoices limit, schema uniques, email validation, stuck-AUTHORIZED, mixed-currency guard)" /tmp/i18.md

# ---------- Issue 19: agent/holds daily-limit batch ----------
cat > /tmp/i19.md <<'EOF'
### Problem
Agent + hold lifecycle gaps (batched):
1. `agents.ts:295-304` — `dailySpendMinor` never resets; the "daily" ceiling is a lifetime ceiling.
2. `agents.ts:249` — daily-spend check uses raw ledger balance, ignoring holds (contradicts financial-kernel.md §6).
3. Hold rows are never marked EXPIRED/RELEASED at expiry time (`cards.ts:112-122`, `transfers.ts:36`) — expiry only honored in query filters; status-only reads inflate.
4. `recon.ts:64` — `'DUPLICATE' as never` writes a case type outside `RECON_CASE_TYPES`; orphan statements are not org-scoped (`:142-145`); dead `webhookEndpoint.findMany` call (`:231`).
5. `appendTimeline` (`payments.ts:41-50`) — read-modify-write JSON array; concurrent events can be dropped (single-process reference build: acceptable, wrap in the posting transaction).
6. Transfers pass `idempotencyKey: null` (`transfers.ts:84`) — documented gap; wire the caller's key through.

### Acceptance Criteria
- [ ] Daily ceiling resets per UTC day (window-based computation from ledger entries).
- [ ] Hold expiry transitions are enforced/reconciled.
- [ ] Recon case types valid; org scoping verified; dead call removed.
- [ ] Transfer idempotency keys flow through.

### Rollback
Reverts per item.
EOF
create "P2,kernel" "Kernel: agent daily-limit semantics, hold expiry, recon typing, transfer idempotency" /tmp/i19.md

# ---------- Issue 20: P3 batch ----------
cat > /tmp/i20.md <<'EOF'
### Problem
P3 polish batch (non-blocking, tracked so nothing disappears):
1. scrypt uses Node default cost (N=16384) — document or raise to OWASP-recommended interactive parameters (breaking change for existing hashes — version the scheme prefix).
2. `api-auth.ts:63-70` — request-body redaction is top-level only; nested secret-ish keys survive into ApiRequestLog.
3. `seed.ts:504` — solar org trial balance computed but not part of the failure condition.
4. `scripts/verify-balances.ts:25-30` — logs FAIL but exits 0 (useless as a gate).
5. `seed-helpers.ts:154-163` — backdating rewrites posted LedgerTransaction timestamps (amounts untouched) — note in ADR-0008.
6. N+1 wallet-balance queries (`wallets/route.ts:20-23`, `transfers.ts:116-148`); no cursor pagination on list endpoints.
7. Login email enumeration timing + P2002 register race (covered in security issue where feasible).
8. `AVATAR_UNUSED` dead code in auth.ts.
9. Copilot/UX P3s: checkout `toLocaleTimeString`, login `autoFocus`, customers `tr[role=button]`.

### Acceptance Criteria
- [ ] Each item either fixed or explicitly waived with rationale in this issue.

### Rollback
Per-item.
EOF
create "P3" "P3 batch: crypto params, redaction depth, seed assertions, N+1, dead code" /tmp/i20.md

echo "ALL ISSUES CREATED"
