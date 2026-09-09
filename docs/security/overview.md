# Security Overview

> Implementation of record: [`src/lib/auth.ts`](../../src/lib/auth.ts) ·
> [`src/lib/session.ts`](../../src/lib/session.ts) ·
> [`src/lib/crypto.ts`](../../src/lib/crypto.ts) ·
> [`src/lib/api-auth.ts`](../../src/lib/api-auth.ts) ·
> [`src/app/api/v1/_lib/auth.ts`](../../src/app/api/v1/_lib/auth.ts) ·
> [`src/lib/webhooks.ts`](../../src/lib/webhooks.ts)

This is a reference build — but it is a *financial* reference build, so the security
posture is real where it matters (authorization, tenancy, secrets at rest, tamper
evidence) and explicitly labeled where it is not (see §7, "honest gaps"). The posture in
one line: **the client is untrusted input; the organization boundary is enforced in
every query; every secret is hashed; every mutation is audited.**

---

## 1. Server-side authorization only

Directive: *never trust the frontend.*

- Every console page/action begins with `requireSession()` (`src/lib/session.ts`), which
  resolves the session server-side from the `novera_session` **httpOnly** cookie and
  redirects to `/login` when absent. Unauthenticated users hitting an `(app)` route get
  a 307 to login — verified behavior, not a client-side hide.
- Every `/api/v1` handler is wrapped by `withApiKey()` which resolves the principal from
  the `Authorization: Bearer nv_…` header **on the server**, then enforces
  authentication → rate limit → scope (ANY-of) → org-scoped handler. The wrapper also
  uniformly converts thrown errors to a 500 envelope, so handlers can't leak stack
  traces by accident.
- Client components never receive secrets or unscoped data: server pages map rows to
  plain serializable props, and BigInt is `.toString()`ed at the boundary (it isn't
  JSON-serializable anyway).
- Role data comes from the `Membership` row resolved server-side; `switchOrganization`
  validates membership before switching the session's active org.

There is no code path where the client asserts its own org, role, or scopes.

## 2. Organization scoping (IDOR defense)

Every tenant-owned table carries `organizationId`, and the rule is mechanical: **the
scope comes from the session/API key, never from the URL.** Pattern used everywhere:

```ts
const session = await requireSession()            // or withApiKey(req, scopes, ...)
const orgId = session.organization.id
db.payment.findFirst({ where: { id: urlId, organizationId: orgId } })  // 404, not leak
```

Concrete enforcement points worth knowing:

- Detail lookups use org-scoped `findFirst` + `notFound()`, so a foreign id yields
  "not found" — existence itself is not disclosed (payments, invoices, cards, agents,
  wallets, approvals, recon cases, keys).
- `postTransaction` verifies **every** entry's account belongs to the posting org
  before writing — you cannot construct a balanced transaction that touches another
  org's accounts.
- Idempotency-key handling in `POST /api/v1/payments` is org-aware: because
  `Payment.idempotencyKey` is globally unique in the SQLite build, a key collision
  across orgs is refused (`PAYMENT_ERROR: This idempotencyKey is already in use by
  another resource`) instead of returning another org's payment object.
- The public checkout (`/pay/{token}`) resolves the link by token (unscoped — that's
  what a public token *is*) but exposes only org name, link label and amount; the
  payment-amount truth for FIXED links is taken from the server-stored row, never from
  the client.

Testing this is part of the red-team checklist (§6, "cross-tenant").

## 3. Passwords and sessions

**Passwords — scrypt, per-user salt, constant-time compare** (`src/lib/crypto.ts`):

```
stored = "scrypt:<16-byte hex salt>:<64-byte hex hash>"   // scryptSync(password, salt, 64)
verify = re-derive candidate and timingSafeEqual against the stored hash
```

Failed logins produce a generic `Invalid email or password` plus a `WARN` audit event
(`auth.login.failed`) — no user enumeration via error differentiation. Successful
logins/registrations are audited (`auth.login`, `auth.registered`).

**Sessions — opaque tokens, revocable** (`src/lib/auth.ts`):

| Property | Value |
|---|---|
| Token | 32 random bytes, hex — no JWT, nothing client-decodable |
| Cookie | `novera_session`, `httpOnly`, `sameSite=lax`, `secure` in production, `path=/` |
| TTL | 7 days (`expiresAt`), enforced on every resolve |
| Revocation | `revokedAt` on the Session row (logout) — resolution also requires the user to be `ACTIVE` |

Because the token is opaque and validated per request, revocation and suspension take
effect immediately; there is no signed-token "can't un-sign it" problem.

## 4. API keys

Keys are the machine equivalent of sessions, with the same hashed-at-rest discipline
(`src/lib/api-auth.ts`):

- Format `nv_test_…` / `nv_live_…` (+12 random chars). **Shown exactly once** at
  creation; only `sha256Hex(secret)` is stored (`keyHash`), alongside a display
  `prefix` and `lastFour`. Creation and revocation are audited (`apikey.created`,
  `apikey.revoked`).
- **Scopes**: JSON array on the key; each endpoint declares the scopes it accepts
  (ANY-of); mismatch → `403 INSUFFICIENT_SCOPE` listing required vs. key scopes.
- **Rate limits**: per-key sliding minute bucket, default **120 req/min**
  (`rateLimitPerMin` per key). Exceeding → `429 RATE_LIMITED` with `Retry-After`
  header, `retryAfterSec` and `resetAt` in the body, and `X-RateLimit-Limit` on every
  authenticated response.
- **Request logs**: every authenticated outcome (including 429/403/5xx) is written to
  `ApiRequestLog` — method, path, status, duration, redacted request body
  (fields matching `/secret|password|token|key/i` become `***`), error code. 401s are
  the exception: the org isn't resolvable from a bad key, so there's nothing safe to
  attribute the row to.
- Key status is checked on every request: `REVOKED` keys fail authentication even
  though their hash matches.

## 5. Webhook signatures & the audit chain

**Outbound webhooks are HMAC-signed** (`src/lib/webhooks.ts`):

```
signature = HMAC-SHA256(endpointSecret, `${unixTimestamp}.${body}`)
verify    = recompute + timingSafeEqual (length-checked first)
```

- The signing secret (`nvwhsec_…`) is generated server-side and returned **once** when
  the endpoint is registered (`POST /api/v1/webhooks/endpoints`, which requires the
  `webhooks:manage` scope and rejects non-HTTPS URLs).
- Every delivery attempt is a first-class `WebhookDelivery` row: payload, signature,
  status, response code, attempt count — inspectable and replayable from the developer
  portal. Consumers should verify the signature and treat the timestamp as a freshness
  bound (replay defense is the consumer's job; the signature makes forgery ours not to
  allow).
- Delivery in the reference build is deterministically simulated (~90% first-attempt
  success, recorded retries, dead-letter) — the delivery *records* are real data, the
  HTTP is not. See [overview.md §4](../architecture/overview.md#4-reference-build-vs-production-target).

**The audit hash chain** is the tamper-evidence layer for everything else: every
mutation of consequence appends an `AuditEvent` whose `hash = sha256(canonical fields ‖
prevHash)`, and `verifyAuditChain()` recomputes the whole chain to find the first break.
Mechanics, canonical field list and verification walkthrough live in
[../architecture/financial-kernel.md §4](../architecture/financial-kernel.md#4-immutability--reversal-only-corrections);
the `/audit` console page surfaces live validity (e.g. *842/842*).

## 6. Red-team checklist

The engineering directive's list, mapped to what the system actually does and how to
try to break it:

| Attack | What the system relies on | How to test it here |
|---|---|---|
| **Double-spend** (spend the same funds twice concurrently) | `executeTransfer` checks available balance (ledger − active holds) *inside the same Prisma transaction that posts entries*; card auth places a `Hold` (reserved ≠ available) before capture; agent execution re-checks available funds | Fire two concurrent transfers draining one wallet to zero — exactly one must succeed; drive a card auth and a transfer against the same wallet and confirm the hold excludes the funds |
| **Replay** (re-submit a completed money operation) | Unique `idempotencyKey` on `Payment` and `LedgerTransaction` with check-before-write semantics; `settle/refund/split/cardauth/agent-intent/fx` keys are deterministic | `POST /api/v1/payments` twice with the same `idempotencyKey` → identical payment object, HTTP 200 the second time, exactly one `ltx_…` posting; replay a refund — second call returns the original posting |
| **Cross-tenant** (IDOR — read or mutate another org's resources) | Org scoping on every query (§2); `postTransaction` account ownership check; org-aware idempotency collision handling | With org A's session/key, request org B's payment id/reference, invoice id, card id, agent id, wallet id → 404s; craft a balanced transaction referencing org B's account codes → `LedgerError`; re-use org B's idempotency key → refusal, not data |
| **Prompt injection** (make the model authorize/execute something) | The LLM has no execution authority: copilot output is JSON-parsed defensively, validated against a fixed tool catalog, and answered with deterministic org-scoped queries; agent intents are untrusted *proposals* gated by the fail-closed policy engine; `executeAgentIntent` is only reachable from policy `ALLOW` or human approval | Tell the copilot to "pay invoice X" or "move 5000 to Suppliers" — it can describe, never move, money; submit an agent intent crafted to impersonate `actorType: USER` or exceed limits → `POLICY_DENIED` with reasons; attempt to call `executeAgentIntent` on a `PENDING_APPROVAL` intent → `AgentError` |
| **Tool abuse** (agent exceeds its granted tools/scopes) | Tool scopes map to policy actions (allow-list); unscoped actions fall through to the fail-closed DECLINE; per-txn/daily ceilings run at priority 10/11 *before* the allow rule at 100 | Register an agent without `payments.propose`, then propose a payment intent → denied "No policy rule matched…"; propose an amount 1 minor unit above the per-txn limit → denied by the ceiling rule; propose above the approval threshold with daily spend near the cap → check which rule wins (ceilings first) |
| **Secret exfiltration at rest** | Passwords scrypt-hashed; session tokens opaque (DB-stored — see gaps); API keys sha256-hashed with prefix+lastFour only for display; webhook secrets stored per-endpoint and returned once; request logs redact secret-ish fields; agent credentials sha256-hashed, prefix-only display | Dump the SQLite file and grep for a known password / a created API key string — neither should appear; grep `ApiRequestLog.requestBody` for `***` on key-bearing payloads |
| **Tamper with history** | Hash-chained append-only `AuditEvent` (§5); posted ledger rows immutable, corrections reversal-only | `UPDATE audit_event SET description=…` on any row directly in SQLite, then reload `/audit` → chain breaks at exactly that event (`firstBrokenAt`) |

Any new endpoint/feature inherits these categories: if it moves money it needs
idempotency + org scoping + audit; if it takes an id it needs the scoped-`findFirst`
pattern; if it feeds an LLM it needs the untrusted-proposal treatment.

## 7. Honest gaps (reference build)

What this build does **not** yet do — on purpose, and stated plainly:

- **MFA**: the `User.mfaEnabled` flag exists but nothing enforces a second factor.
- **Login rate limiting**: API keys are rate-limited per key; interactive login is not
  throttled (failed attempts are audited). Production needs per-account + per-IP
  lockout.
- **Rate limiter is in-process memory**: per-instance only; horizontally scaled
  deployment requires the Redis-backed equivalent (the `checkRateLimit` seam is
  isolated for exactly this).
- **Session tokens are stored raw** in the Session table (they are opaque to clients,
  but a database compromise would yield live tokens). Production target: hash the
  token at rest.
- **Fast unsalted hashes for high-entropy secrets**: API keys and agent credentials use
  plain sha256 — acceptable because the secrets are ≥72 bits of RNG, but a production
  hardening pass would use HMAC-SHA256 with a server pepper or a memory-hard KDF.
- **Webhook delivery is simulated** — signatures, retries and dead-letter *records* are
  real; no actual outbound HTTP occurs.
- **Card auth is single-phase** (auth+capture collapsed); PANs are never stored
  (tokenized, last4 only) but the two-phase network flow is a production behavior.
- **No CSRF token on server actions**: same-site `lax` cookies plus POST-only actions
  are the current mitigation; a dedicated token layer is on the hardening list.

## 8. Incident response

When something is actively wrong, follow
[../runbooks/security-incident.md](../runbooks/security-incident.md) — key revocation,
card/agent freezes, audit-chain verification, in that order. For suspected ledger
discrepancies use [../runbooks/ledger-discrepancy.md](../runbooks/ledger-discrepancy.md);
for rail availability, [../runbooks/provider-outage.md](../runbooks/provider-outage.md).
