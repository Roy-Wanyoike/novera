/**
 * API v1 — OpenAPI 3.1 document, served from GET /api/v1/openapi.json.
 *
 * Hand-maintained to mirror the live route tree (auth envelope, scopes,
 * schemas). Every monetary amount is a decimal string of minor units —
 * BigInt never crosses the wire.
 */

const bearerAuth = [{ bearerAuth: [] as string[] }]

const errorResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorEnvelope' },
    },
  },
})

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Novera API',
    version: '1.0.0',
    summary: 'Programmable financial infrastructure — wallets, payments, ledger, webhooks.',
    description:
      'Novera exposes the financial kernel over a versioned REST API. Every response is ' +
      'wrapped in a `{data}` envelope; errors use `{error:{code, message}}`. All amounts are ' +
      'exact integer minor units serialized as decimal strings — never floats. ' +
      '**This reference environment runs in TEST mode: all providers are deterministic simulators; no real settlement occurs.**',
    'x-mode': 'TEST',
  },
  servers: [
    { url: '/api/v1', description: 'Sandbox (TEST mode — deterministic providers)' },
  ],
  security: bearerAuth,
  tags: [
    { name: 'Platform', description: 'Health and machine-readable spec' },
    { name: 'Wallets', description: 'Multi-currency wallets and balances' },
    { name: 'Payments', description: 'Payment intents across rails' },
    { name: 'Ledger', description: 'Double-entry transactions' },
    { name: 'Invoices', description: 'Billing documents' },
    { name: 'Webhooks', description: 'Signed outbound events' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API key of the form `nv_test_…` or `nv_live_…`. Only the sha256 hash is stored server-side.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', enum: ['UNAUTHENTICATED', 'INSUFFICIENT_SCOPE', 'INVALID_ARGUMENT', 'NOT_FOUND', 'PAYMENT_ERROR', 'RATE_LIMITED', 'INTERNAL'] },
          message: { type: 'string' },
          requiredScopes: { type: 'array', items: { type: 'string' } },
          retryAfterSec: { type: 'integer' },
          resetAt: { type: 'string', format: 'date-time' },
        },
      },
      ErrorEnvelope: {
        type: 'object',
        required: ['error'],
        properties: { error: { $ref: '#/components/schemas/Error' } },
      },
      Wallet: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string', examples: ['Operating'] },
          type: { type: 'string', enum: ['OPERATING', 'TAX', 'RESERVE', 'PAYROLL', 'PROJECT', 'SUPPLIER', 'AGENT', 'SETTLEMENT', 'PERSONAL'] },
          currency: { type: 'string', examples: ['KES'] },
          status: { type: 'string', enum: ['ACTIVE', 'FROZEN', 'ARCHIVED'] },
          description: { type: 'string', nullable: true },
          ledgerMinor: { type: 'string', description: 'Ledger balance in minor units (decimal string)', examples: ['1250000'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Balance: {
        type: 'object',
        properties: {
          currency: { type: 'string' },
          ledgerMinor: { type: 'string' },
          availableMinor: { type: 'string', description: 'Ledger minus active holds. Pending funds are never available.' },
          reservedMinor: { type: 'string' },
          walletCount: { type: 'integer' },
        },
      },
      PaymentSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          reference: { type: 'string', examples: ['pay_abc123def456'] },
          status: { type: 'string', enum: ['CREATED', 'AUTHORIZED', 'PROCESSING', 'PENDING', 'SETTLED', 'FAILED', 'CANCELLED', 'REFUNDED', 'REVERSED', 'DISPUTED'] },
          amountMinor: { type: 'string' },
          feeMinor: { type: 'string' },
          currency: { type: 'string' },
          method: { type: 'string', enum: ['MPESA', 'BANK', 'CARD', 'WALLET', 'USDC'] },
          direction: { type: 'string', enum: ['IN', 'OUT'] },
          customerEmail: { type: 'string', nullable: true },
          riskDecision: { type: 'string', nullable: true, enum: ['ALLOW', 'REVIEW', 'DECLINE', null] },
          riskScore: { type: 'integer', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          settledAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      TimelineEvent: {
        type: 'object',
        properties: {
          at: { type: 'string', format: 'date-time' },
          event: { type: 'string', examples: ['risk_evaluated'] },
          detail: { type: 'string' },
        },
      },
      Payment: {
        allOf: [{ $ref: '#/components/schemas/PaymentSummary' }],
        type: 'object',
        properties: {
          refundedMinor: { type: 'string' },
          description: { type: 'string', nullable: true },
          risk: { type: 'object', nullable: true, properties: { decision: { type: 'string' }, score: { type: 'integer' } } },
          provider: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'string' },
              code: { type: 'string', examples: ['MPESA_V1'] },
              name: { type: 'string' },
              railType: { type: 'string' },
              mode: { type: 'string', enum: ['TEST'] },
            },
          },
          providerReference: { type: 'string', nullable: true },
          ledgerTransactionId: { type: 'string', nullable: true },
          failureReason: { type: 'string', nullable: true },
          timeline: { type: 'array', items: { $ref: '#/components/schemas/TimelineEvent' } },
          idempotencyKey: { type: 'string', nullable: true },
          failedAt: { type: 'string', format: 'date-time', nullable: true },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      CreatePaymentRequest: {
        type: 'object',
        required: ['amount', 'currency', 'method'],
        properties: {
          amount: { type: 'string', description: 'Decimal major-unit string, e.g. "1250.00"', examples: ['1250.00'] },
          currency: { type: 'string', enum: ['KES', 'USD', 'EUR', 'GBP', 'NGN', 'TZS', 'UGX', 'ZAR', 'USDC'] },
          method: { type: 'string', enum: ['MPESA', 'BANK', 'CARD', 'WALLET', 'USDC'] },
          customerEmail: { type: 'string', format: 'email' },
          description: { type: 'string', maxLength: 500 },
          idempotencyKey: { type: 'string', maxLength: 255, description: 'Replaying a key returns the original payment.' },
        },
      },
      LedgerEntry: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['DEBIT', 'CREDIT'] },
          amountMinor: { type: 'string' },
          currency: { type: 'string' },
          account: {
            type: 'object',
            properties: {
              code: { type: 'string', examples: ['WALLET:KES:Operating'] },
              name: { type: 'string' },
              type: { type: 'string', enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] },
              isSystemAccount: { type: 'boolean' },
            },
          },
        },
      },
      Transaction: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          reference: { type: 'string', examples: ['ltx_abc123def456'] },
          description: { type: 'string' },
          source: { type: 'string', enum: ['TRANSFER', 'PAYMENT', 'PAYOUT', 'FX_CONVERSION', 'SPLIT_RULE', 'AGENT', 'CARD_AUTH', 'ADJUSTMENT', 'REVERSAL', 'FEE', 'OPENING'] },
          status: { type: 'string', enum: ['PENDING', 'POSTED', 'REVERSED'] },
          amountMinor: { type: 'string' },
          currency: { type: 'string' },
          effectiveAt: { type: 'string', format: 'date-time' },
          postedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          actor: { type: 'object', properties: { type: { type: 'string' }, id: { type: 'string', nullable: true }, label: { type: 'string', nullable: true } } },
          entries: { type: 'array', items: { $ref: '#/components/schemas/LedgerEntry' } },
        },
      },
      Invoice: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          number: { type: 'string', examples: ['INV-2026-0001'] },
          status: { type: 'string', enum: ['DRAFT', 'ISSUED', 'VIEWED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'] },
          currency: { type: 'string' },
          subtotalMinor: { type: 'string' },
          taxMinor: { type: 'string' },
          discountMinor: { type: 'string' },
          totalMinor: { type: 'string' },
          amountPaidMinor: { type: 'string' },
          customer: { type: 'object', nullable: true, properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } } },
          issuedAt: { type: 'string', format: 'date-time', nullable: true },
          dueAt: { type: 'string', format: 'date-time', nullable: true },
          paidAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      WebhookEndpoint: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          description: { type: 'string', nullable: true },
          events: { type: 'array', items: { type: 'string' }, examples: [['payment.settled', 'payment.failed']] },
          status: { type: 'string', enum: ['ACTIVE', 'PAUSED'] },
          secret: { type: 'string', description: 'Signing secret (nvwhsec_…) — returned only at creation.' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', const: 'ok' },
          mode: { type: 'string', const: 'TEST' },
          time: { type: 'string', format: 'date-time' },
          service: { type: 'string' },
          version: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Platform'],
        summary: 'Liveness probe',
        description: 'No authentication required.',
        security: [],
        responses: { 200: { description: 'Service healthy', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Health' } } } } } } },
      },
    },
    '/openapi.json': {
      get: {
        tags: ['Platform'],
        summary: 'This document',
        security: [],
        responses: { 200: { description: 'OpenAPI 3.1 document', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    },
    '/wallets': {
      get: {
        tags: ['Wallets'],
        summary: 'List wallets with ledger balances',
        description: 'Requires scope `wallets:read`.',
        responses: {
          200: {
            description: 'Wallet list',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { wallets: { type: 'array', items: { $ref: '#/components/schemas/Wallet' } }, count: { type: 'integer' } } } } } } },
          },
          401: errorResponse('Missing or invalid API key'),
          403: errorResponse('Missing wallets:read scope'),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/balances': {
      get: {
        tags: ['Wallets'],
        summary: 'Per-currency balances',
        description: 'Ledger vs available (ledger − active holds). Requires scope `balances:read` or `wallets:read`.',
        responses: {
          200: {
            description: 'Balances per currency',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { balances: { type: 'array', items: { $ref: '#/components/schemas/Balance' } } } } } } } },
          },
          401: errorResponse('Missing or invalid API key'),
          403: errorResponse('Insufficient scope'),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/payments': {
      get: {
        tags: ['Payments'],
        summary: 'List payments',
        description: 'Requires scope `payments:write` or `wallets:read`.',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['CREATED', 'AUTHORIZED', 'PROCESSING', 'PENDING', 'SETTLED', 'FAILED', 'CANCELLED', 'REFUNDED', 'REVERSED', 'DISPUTED'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
        ],
        responses: {
          200: {
            description: 'Payment list',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { payments: { type: 'array', items: { $ref: '#/components/schemas/PaymentSummary' } }, count: { type: 'integer' } } } } } } },
          },
          400: errorResponse('Invalid status or limit'),
          401: errorResponse('Missing or invalid API key'),
          403: errorResponse('Insufficient scope'),
          429: errorResponse('Rate limit exceeded'),
        },
      },
      post: {
        tags: ['Payments'],
        summary: 'Create a payment',
        description:
          'Runs risk evaluation before rail submission, posts balanced ledger entries on settlement and emits signed webhooks. ' +
          'A FAILED payment still returns 201 — inspect `status` and `failureReason`. ' +
          'Replaying the same `idempotencyKey` returns the original payment with 200. Requires scope `payments:write`.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatePaymentRequest' } } },
        },
        responses: {
          200: { description: 'Idempotent replay — original payment returned', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Payment' } } } } } },
          201: { description: 'Payment created', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Payment' } } } } } },
          400: errorResponse('Invalid amount / currency / method'),
          401: errorResponse('Missing or invalid API key'),
          403: errorResponse('Missing payments:write scope'),
          422: errorResponse('Payment engine rejected the request'),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/payments/{id}': {
      get: {
        tags: ['Payments'],
        summary: 'Retrieve a payment',
        description: 'Accepts the internal id or the `pay_…` reference. Includes timeline, risk and provider details. Requires scope `payments:write` or `wallets:read`.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Payment detail', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Payment' } } } } } },
          404: errorResponse('Payment not found in this organization'),
          401: errorResponse('Missing or invalid API key'),
          403: errorResponse('Insufficient scope'),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/transactions': {
      get: {
        tags: ['Ledger'],
        summary: 'Recent ledger transactions',
        description: 'Balanced double-entry postings with account detail. Requires scope `wallets:read` or `balances:read`.',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }],
        responses: {
          200: {
            description: 'Transaction list',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { transactions: { type: 'array', items: { $ref: '#/components/schemas/Transaction' } }, count: { type: 'integer' } } } } } } },
          },
          400: errorResponse('Invalid limit'),
          401: errorResponse('Missing or invalid API key'),
          403: errorResponse('Insufficient scope'),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/invoices': {
      get: {
        tags: ['Invoices'],
        summary: 'List invoices',
        description: 'Requires scope `payments:write` or `wallets:read`.',
        responses: {
          200: {
            description: 'Invoice list',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { invoices: { type: 'array', items: { $ref: '#/components/schemas/Invoice' } }, count: { type: 'integer' } } } } } } },
          },
          401: errorResponse('Missing or invalid API key'),
          403: errorResponse('Insufficient scope'),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/webhooks/endpoints': {
      get: {
        tags: ['Webhooks'],
        summary: 'List webhook endpoints',
        description: 'Signing secrets are never returned on read. Requires scope `webhooks:manage`.',
        responses: {
          200: {
            description: 'Endpoint list',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { endpoints: { type: 'array', items: { $ref: '#/components/schemas/WebhookEndpoint' } }, count: { type: 'integer' } } } } } } },
          },
          401: errorResponse('Missing or invalid API key'),
          403: errorResponse('Missing webhooks:manage scope'),
          429: errorResponse('Rate limit exceeded'),
        },
      },
      post: {
        tags: ['Webhooks'],
        summary: 'Register a webhook endpoint',
        description: 'The response includes the `secret` (nvwhsec_…) exactly once. Requires scope `webhooks:manage`.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'events'],
                properties: {
                  url: { type: 'string', format: 'uri', description: 'HTTPS URL that receives POSTs' },
                  events: { type: 'array', items: { type: 'string' }, description: 'Event names or "*"' },
                  description: { type: 'string', maxLength: 200 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Endpoint registered (secret included once)', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/WebhookEndpoint' } } } } } },
          400: errorResponse('Invalid url / events'),
          401: errorResponse('Missing or invalid API key'),
          403: errorResponse('Missing webhooks:manage scope'),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
  },
} as const

export type OpenApiSpec = typeof openApiSpec
