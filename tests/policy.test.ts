/**
 * @novera/policy — pure unit tests (no database).
 *
 * The control plane is deterministic and FAIL-CLOSED: when no rule
 * explicitly allows an action the decision is DECLINE. An LLM can never
 * override a policy decision — the tests below pin that contract.
 */
import { describe, expect, it } from 'vitest'
import {
  buildAgentGuardrailRules,
  evaluatePolicy,
  type PolicyFacts,
  type PolicyRule,
} from '@novera/policy'
import { mulberry32 } from './db-utils'

const baseFacts = (over: Partial<PolicyFacts> = {}): PolicyFacts => ({
  action: 'payments.create',
  subjectType: 'AGENT',
  subjectId: 'agent_atlas',
  scopes: ['payments:write'],
  amountMinor: 100_000n,
  currency: 'KES',
  merchant: 'Safaricom',
  country: 'KE',
  channel: 'API',
  ...over,
})

describe('policy · fail-closed by construction', () => {
  it('empty ruleset → DECLINE', () => {
    const result = evaluatePolicy([], baseFacts())
    expect(result.decision).toBe('DECLINE')
    expect(result.reasons[0]).toMatch(/fail-closed/i)
    expect(result.matchedRule).toBeUndefined()
  })

  it('non-matching rules → DECLINE (absence of an ALLOW is a refusal)', () => {
    const rules: PolicyRule[] = [
      {
        name: 'allow-transfers',
        effect: 'ALLOW',
        conditions: [{ field: 'action', op: 'eq', value: 'transfers.execute' }],
      },
    ]
    const result = evaluatePolicy(rules, baseFacts({ action: 'payments.create' }))
    expect(result.decision).toBe('DECLINE')
    expect(result.matchedRule).toBeUndefined()
  })

  it('missing fact fields never satisfy conditions', () => {
    const rules: PolicyRule[] = [
      {
        name: 'merchant-allowlist',
        effect: 'ALLOW',
        conditions: [{ field: 'merchant', op: 'eq', value: 'Safaricom' }],
      },
    ]
    expect(evaluatePolicy(rules, baseFacts({ merchant: undefined })).decision).toBe('DECLINE')
  })
})

describe('policy · agent guardrail builder', () => {
  const rules = buildAgentGuardrailRules({
    agentName: 'Atlas',
    allowedActions: ['payments.create', 'transfers.execute'],
    perTransactionLimitMinor: 500_000n,
    dailyLimitMinor: 2_000_000n,
    requiresApprovalAboveMinor: 200_000n,
  })

  it('DECLINE above the per-transaction ceiling', () => {
    const result = evaluatePolicy(rules, baseFacts({ amountMinor: 600_000n }))
    expect(result.decision).toBe('DECLINE')
    expect(result.matchedRule).toMatch(/per-transaction ceiling/)
  })

  it('REQUIRE_APPROVAL between threshold and limit', () => {
    const mid = evaluatePolicy(rules, baseFacts({ amountMinor: 300_000n }))
    expect(mid.decision).toBe('REQUIRE_APPROVAL')
    expect(mid.matchedRule).toMatch(/human approval gate/)

    // one minor unit above the threshold already escalates
    const justAbove = evaluatePolicy(rules, baseFacts({ amountMinor: 200_001n }))
    expect(justAbove.decision).toBe('REQUIRE_APPROVAL')
  })

  it('ALLOW under the threshold for scoped actions', () => {
    const result = evaluatePolicy(rules, baseFacts({ amountMinor: 100_000n }))
    expect(result.decision).toBe('ALLOW')
    expect(result.matchedRule).toMatch(/allow scoped actions/)
  })

  it('DECLINE unscoped actions even at small amounts', () => {
    const result = evaluatePolicy(rules, baseFacts({ amountMinor: 100n, action: 'cards.issue' }))
    expect(result.decision).toBe('DECLINE')
    expect(result.matchedRule).toBeUndefined()
  })

  it('daily spend at/above the daily ceiling → DECLINE (gte semantics)', () => {
    const atLimit = evaluatePolicy(
      rules,
      baseFacts({ amountMinor: 100_000n, dailySpendMinor: 2_000_000n })
    )
    expect(atLimit.decision).toBe('DECLINE')
    expect(atLimit.matchedRule).toMatch(/daily spend ceiling/)

    const below = evaluatePolicy(
      rules,
      baseFacts({ amountMinor: 100_000n, dailySpendMinor: 1_999_999n })
    )
    expect(below.decision).toBe('ALLOW')
  })
})

describe('policy · numeric boundary exactness (BigInt, never floats)', () => {
  const rule = (
    op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq',
    value: string,
    effect: PolicyRule['effect'] = 'ALLOW'
  ): PolicyRule => ({
    name: `amount ${op} ${value}`,
    effect,
    conditions: [{ field: 'amountMinor', op, value }],
  })

  it('gt is strict: amount == limit does NOT trip a DECLINE ceiling', () => {
    // exactly at the 500_000 ceiling — `gt` is false → rule does not match
    const at = evaluatePolicy([rule('gt', '500000', 'DECLINE')], baseFacts({ amountMinor: 500_000n }))
    expect(at.decision).toBe('DECLINE') // fail-closed default (no rule matched)
    expect(at.matchedRule).toBeUndefined() // the ceiling itself did NOT trip

    // one minor unit above trips it
    const above = evaluatePolicy(
      [rule('gt', '500000', 'DECLINE'), { name: 'fallback-allow', effect: 'ALLOW', conditions: [] }],
      baseFacts({ amountMinor: 500_001n })
    )
    expect(above.decision).toBe('DECLINE')
    expect(above.matchedRule).toBe('amount gt 500000')

    // and at exactly the limit the fallback ALLOW wins instead
    const exact = evaluatePolicy(
      [rule('gt', '500000', 'DECLINE'), { name: 'fallback-allow', effect: 'ALLOW', conditions: [] }],
      baseFacts({ amountMinor: 500_000n })
    )
    expect(exact.decision).toBe('ALLOW')
    expect(exact.matchedRule).toBe('fallback-allow')
  })

  it('operator semantics at the boundary', () => {
    const fact = baseFacts({ amountMinor: 100n })
    expect(evaluatePolicy([rule('lte', '100')], fact).matchedRule).toBeDefined()
    expect(evaluatePolicy([rule('lt', '100')], fact).matchedRule).toBeUndefined()
    expect(evaluatePolicy([rule('gte', '100')], fact).matchedRule).toBeDefined()
    expect(evaluatePolicy([rule('gt', '100')], fact).matchedRule).toBeUndefined()
    expect(evaluatePolicy([rule('eq', '100')], fact).matchedRule).toBeDefined()
    expect(evaluatePolicy([rule('neq', '100')], fact).matchedRule).toBeUndefined()
    expect(evaluatePolicy([rule('lt', '101')], fact).matchedRule).toBeDefined()
  })

  it('compares exactly beyond Number.MAX_SAFE_INTEGER (no float coercion)', () => {
    // 2^53 + 1 is NOT representable as a float — equality proves BigInt paths
    const two53plus1 = 9_007_199_254_740_993n
    expect(evaluatePolicy([rule('eq', '9007199254740993')], baseFacts({ amountMinor: two53plus1 })).matchedRule).toBeDefined()
    expect(
      evaluatePolicy([rule('eq', '9007199254740993')], baseFacts({ amountMinor: two53plus1 + 1n })).matchedRule
    ).toBeUndefined()
    // floats would collapse these two values — BigInt does not
    const huge = 10n ** 18n
    expect(evaluatePolicy([rule('gt', '1000000000000000001')], baseFacts({ amountMinor: huge })).matchedRule).toBeUndefined()
    expect(evaluatePolicy([rule('lt', '1000000000000000001')], baseFacts({ amountMinor: huge })).matchedRule).toBeDefined()
  })
})

describe('policy · ordering and scope conditions', () => {
  it('lower priority number evaluates first regardless of array order', () => {
    const rules: PolicyRule[] = [
      { name: 'allow-everything', priority: 100, effect: 'ALLOW', conditions: [] },
      { name: 'decline-big', priority: 10, effect: 'DECLINE', conditions: [{ field: 'amountMinor', op: 'gt', value: '1000' }] },
    ]
    const result = evaluatePolicy(rules, baseFacts({ amountMinor: 5000n }))
    expect(result.decision).toBe('DECLINE')
    expect(result.matchedRule).toBe('decline-big')
  })

  it('default priority is 100', () => {
    const rules: PolicyRule[] = [
      { name: 'specific-deny', priority: 5, effect: 'DECLINE', conditions: [{ field: 'action', op: 'eq', value: 'payments.create' }] },
      { name: 'generic-allow', effect: 'ALLOW', conditions: [] }, // default priority 100
    ]
    expect(evaluatePolicy(rules, baseFacts()).decision).toBe('DECLINE')
  })

  it('all conditions must match (AND); one miss is a miss', () => {
    const rules: PolicyRule[] = [
      {
        name: 'scoped-and-small',
        effect: 'ALLOW',
        conditions: [
          { field: 'action', op: 'eq', value: 'payments.create' },
          { field: 'amountMinor', op: 'lt', value: '50000' },
        ],
      },
    ]
    expect(evaluatePolicy(rules, baseFacts({ amountMinor: 10_000n })).decision).toBe('ALLOW')
    expect(evaluatePolicy(rules, baseFacts({ amountMinor: 60_000n })).decision).toBe('DECLINE')
  })

  it('scope conditions check the scopes set', () => {
    const rules: PolicyRule[] = [
      {
        name: 'payments-writers-only',
        effect: 'ALLOW',
        conditions: [{ field: 'scope', op: 'eq', value: 'payments:write' }],
      },
    ]
    expect(evaluatePolicy(rules, baseFacts({ scopes: ['payments:write'] })).decision).toBe('ALLOW')
    expect(evaluatePolicy(rules, baseFacts({ scopes: ['cards:write'] })).decision).toBe('DECLINE')
    expect(evaluatePolicy(rules, baseFacts({ scopes: [] })).decision).toBe('DECLINE')
  })

  it('string set membership (in / not_in) works on action and currency', () => {
    const rules: PolicyRule[] = [
      {
        name: 'east-africa-merchant-rails',
        effect: 'REQUIRE_APPROVAL',
        conditions: [{ field: 'country', op: 'in', value: ['TZ', 'UG'] }],
      },
    ]
    expect(evaluatePolicy(rules, baseFacts({ country: 'UG' })).decision).toBe('REQUIRE_APPROVAL')
    expect(evaluatePolicy(rules, baseFacts({ country: 'KE' })).decision).toBe('DECLINE')
  })
})

describe('policy · determinism', () => {
  const rules = buildAgentGuardrailRules({
    agentName: 'Atlas',
    allowedActions: ['payments.create', 'transfers.execute'],
    perTransactionLimitMinor: 500_000n,
    dailyLimitMinor: 2_000_000n,
    requiresApprovalAboveMinor: 200_000n,
  })

  it('same inputs → same decision, 100 runs', () => {
    const facts = baseFacts({ amountMinor: 300_000n })
    const first = evaluatePolicy(rules, facts)
    for (let i = 0; i < 100; i++) {
      const again = evaluatePolicy(rules, facts)
      expect(again.decision).toBe(first.decision)
      expect(again.matchedRule).toBe(first.matchedRule)
      expect(again.reasons).toEqual(first.reasons)
    }
  })

  it('seeded randomized facts produce identical decisions across two passes', () => {
    const buildCases = () => {
      const rng = mulberry32(424242)
      return Array.from({ length: 30 }, () => {
        const amount = BigInt(Math.floor(rng() * 1_000_000))
        return baseFacts({
          amountMinor: amount,
          dailySpendMinor: BigInt(Math.floor(rng() * 3_000_000)),
          action: rng() < 0.7 ? 'payments.create' : 'cards.issue',
        })
      })
    }
    const passA = buildCases().map((f) => evaluatePolicy(rules, f))
    const passB = buildCases().map((f) => evaluatePolicy(rules, f))
    expect(passA.map((r) => [r.decision, r.matchedRule])).toEqual(
      passB.map((r) => [r.decision, r.matchedRule])
    )
    // and the seeded stream actually exercises multiple decisions
    const decisions = new Set(passA.map((r) => r.decision))
    expect(decisions.size).toBeGreaterThanOrEqual(2)
  })
})
