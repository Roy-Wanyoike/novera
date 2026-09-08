# API v1 — Notes for Humans

> Machine-readable contract (OpenAPI 3.1): **[`GET /api/v1/openapi.json`](/api/v1/openapi.json)**
> (unauthenticated, served from
> [`src/app/api/v1/_lib/openapi.ts`](../../src/app/api/v1/_lib/openapi.ts)). This page
> is the prose companion — when the two disagree, the JSON wins and this page gets a PR.

Also see: [../architecture/overview.md](../architecture/overview.md) (lifecycle),
[../security/overview.md](../security/overview.md) (auth model),
[../runbooks/provider-outage.md](../runbooks/provider-outage.md).

**This reference environment runs in TEST mode** — every provider is a deterministic
simulator and no real settlement occurs. The spec carries `x-mode: TEST` and the health
endpoint reports it.

---

## 1. Authentication

```
Authorization: Bearer nv_test_…        # or nv_live_…
```

- Keys are created in the console (`/developers/keys`) or by an operator flow; the
  secret is shown **once**, only its sha256 hash is stored.
- Every authenticated request passes: key lookup (revoked keys 401) → **rate limit**
  (default **120 req/min per key**; `X-RateLimit-Limit` on responses; 429 responses
  carry `Retry-After`, `retryAfterSec`, `resetAt`) → **scope check** (the key needs at
  least one of the endpoint's listed scopes; ANY-of semantics) → handler.
- The org context comes from the key — there is no way to address another
  organization's data.
- Requests are logged (`ApiRequestLog`) with redacted bodies; 401s are not (the org
  isn't resolvable from a bad key).

## 2. Conventions

- **Success envelope**: `{ "data": { … } }` (201 on create, 200 otherwise).
- **Error envelope**: `{ "error": { "code", "message", …extras } }` plus an
  `x-novera-error-code` response header.

  | Code | HTTP | Meaning |
  |---|---|---|
  | `UNAUTHENTICATED` | 401 | Missing/invalid/revoked Bearer key |
  | `INSUFFICIENT_SCOPE` | 403 | Key lacks all of the endpoint's scopes (lists both sides) |
  | `RATE_LIMITED` | 429 | Per-key minute bucket exceeded |
  | `INVALID_ARGUMENT` | 400 | Validation failure (message says which field and why) |
  | `NOT_FOUND` | 404 | Resource doesn't exist *in this organization* |
  | `PAYMENT_ERROR` | 422 | Kernel rejected the operation (e.g. no provider for method, idempotency-key collision across orgs) |
  | `INTERNAL` | 500 | Unexpected failure (logged server-side, no stack leak) |

- **Money is decimal-string minor units**, always: `"amountMinor": "125000"` for
  KSh 1,250.00. BigInt never crosses the wire; request amounts are decimal strings
  parsed by `Money.fromMajor` (exact — `"1250.001"` in KES is a 400, floats never
  enter the money path). Wallet objects also carry a formatted string for display.
- **A failed payment is a successful API call.** `POST /payments` returns 201 with
  `status: "FAILED"` + `failureReason` — the object is the truth; there is no fake
  success. `PENDING` payments report `"processing"` honestly.

## 3. Idempotency

`POST /api/v1/payments` accepts an idempotency key via the `idempotencyKey` body field
or the `Idempotency-Key` header (≤255 chars). Replay with the same key returns the
*original* payment object (HTTP 200, not 201) with **no new side effects** — no second
rail submission, no second ledger posting. Under the hood the payment row and its
settlement posting both carry unique idempotency constraints
([../architecture/financial-kernel.md §5](../architecture/financial-kernel.md#5-idempotency-keys)).

## 4. Endpoint table

| Method & path | Scopes (ANY-of) | Success | Notes |
|---|---|---|---|
| `GET /api/v1/health` | — (public) | 200 | Liveness: `{status, mode, time, service, version}`. Not logged. |
| `GET /api/v1/openapi.json` | — (public) | 200 | The OpenAPI 3.1 document itself (60s cache). |
| `GET /api/v1/wallets` | `wallets:read` | 200 | Org wallets with **authoritative ledger balances** (`ledgerMinor`). |
| `GET /api/v1/balances` | `balances:read` · `wallets:read` | 200 | Per-currency roll-up: `ledgerMinor`, `availableMinor` (ledger − active holds), `reservedMinor`. Pending is never available. |
| `GET /api/v1/transactions` | `wallets:read` · `balances:read` | 200 | Ledger transactions incl. balanced double-entry lines. `?limit=` 1–100 (default 25). |
| `GET /api/v1/payments` | `payments:write` · `wallets:read` | 200 | `?status=` (validated against the payment status union), `?limit=` 1–100. |
| `POST /api/v1/payments` | `payments:write` | 201 / 200-replay | Body: `{amount (decimal string), currency, method, customerEmail?, description?, idempotencyKey?}`. Runs risk before the rail; settlement posts the ledger leg and emits signed webhooks. |
| `GET /api/v1/payments/{id}` | `payments:write` · `wallets:read` | 200 | `{id}` accepts the internal id **or** the `pay_…` reference. Full timeline + risk + provider detail. 404 for foreign orgs. |
| `GET /api/v1/invoices` | `payments:write` · `wallets:read` | 200 | Invoices with totals and payment state. |
| `GET /api/v1/webhooks/endpoints` | `webhooks:manage` | 200 | Endpoint list — **never** returns secrets. |
| `POST /api/v1/webhooks/endpoints` | `webhooks:manage` | 201 | `{url (HTTPS required), events (valid catalog names or "*"), description?}`. Returns the `nvwhsec_…` signing secret exactly once. |

Valid payment methods: `MPESA · BANK · CARD · WALLET · USDC`. Valid payment statuses:
`CREATED · AUTHORIZED · PROCESSING · PENDING · SETTLED · FAILED · CANCELLED · REFUNDED ·
REVERSED · DISPUTED`.

## 5. Webhooks (outbound)

Registering an endpoint starts signed event delivery
([../security/overview.md §5](../security/overview.md#5-webhook-signatures--the-audit-chain)):

```
signature = HMAC-SHA256(endpointSecret, `${unixTimestamp}.${body}`)
```

Body shape: `{ id: "wh_…", event, createdAt, data }`. Event catalog lives in
[`packages/events/src/index.ts`](../../packages/events/src/index.ts)
(`payment.settled`, `payment.failed`, `payment.refunded`, `invoice.paid`,
`agent.intent.executed`, `approval.requested`, `approval.decided`,
`fx.conversion.executed`, `splitrule.executed`, …). Verify the signature and treat the
timestamp as a freshness bound. Delivery attempts (with retries and dead-letter) are
recorded as inspectable/replayable data in the developer portal.

## 6. Quick smoke test

```bash
KEY=nv_test_…   # from /developers/keys

curl -s /api/v1/health
curl -s -H "Authorization: Bearer $KEY" /api/v1/balances
curl -s -H "Authorization: Bearer $KEY" /api/v1/payments?status=SETTLED&limit=5

curl -s -X POST /api/v1/payments \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"amount":"1250.00","currency":"KES","method":"MPESA",
       "customerEmail":"buyer@example.com","idempotencyKey":"demo-001"}'
# replay the same call → identical object, no double posting
```

(Note: when testing through the sandbox gateway, prefix paths with the gateway origin
you were given — the routes above are the canonical API paths.)
