/**
 * @novera/money — pure unit tests (no database).
 *
 * The money package is the atomic unit of the financial kernel: every
 * invariant below (exact minor units, currency qualification, lossless
 * allocation, exact formatting) is load-bearing for the ledger.
 */
import { describe, expect, it } from 'vitest'
import {
  CURRENCIES,
  Money,
  MoneyError,
  assertCurrency,
  formatMinor,
  formatSignedMinor,
  isCurrency,
} from '@novera/money'
import { mulberry32, randInt } from './db-utils'

describe('money · construction round-trips', () => {
  it('fromMajor → minor → toMajorString round-trips exactly', () => {
    expect(Money.fromMajor('1234.50', 'KES').minor).toBe(123450n)
    // toMajorString groups thousands but fromMajor strips commas → lossless
    expect(Money.fromMinor(123450n, 'KES').toMajorString()).toBe('1,234.50')
    expect(Money.fromMajor(Money.fromMinor(123450n, 'KES').toMajorString(), 'KES').minor).toBe(123450n)

    expect(Money.fromMajor('-1234.50', 'KES').minor).toBe(-123450n)
    expect(Money.fromMinor(-123450n, 'KES').toMajorString()).toBe('-1,234.50')

    expect(Money.fromMajor('0.00', 'KES').minor).toBe(0n)
    expect(Money.fromMinor(0n, 'KES').toMajorString()).toBe('0.00')
  })

  it('round-trips across minor-unit scales (KES 2, USDC 6, UGX 0)', () => {
    // USDC has 6 decimals
    expect(Money.fromMajor('1.234567', 'USDC').minor).toBe(1234567n)
    expect(Money.fromMinor(1234567n, 'USDC').toMajorString()).toBe('1.234567')
    expect(Money.fromMajor('0.000001', 'USDC').minor).toBe(1n)

    // UGX has 0 decimals — minor units ARE the major units
    expect(Money.fromMajor('1234', 'UGX').minor).toBe(1234n)
    expect(Money.fromMinor(1234n, 'UGX').toMajorString()).toBe('1,234')
    expect(Money.fromMinor(1234n, 'UGX').format()).toBe('USh 1,234')
    expect(Money.fromMajor(Money.fromMinor(1234n, 'UGX').toMajorString(), 'UGX').minor).toBe(1234n)
  })

  it('fromMinor accepts bigint, integer number and numeric string', () => {
    expect(Money.fromMinor(123450n, 'KES').minor).toBe(123450n)
    expect(Money.fromMinor(123450, 'KES').minor).toBe(123450n)
    expect(Money.fromMinor('123450', 'KES').minor).toBe(123450n)
    expect(Money.fromMinor('-450', 'KES').minor).toBe(-450n)
  })

  it('fromMinor rejects non-integer numbers (floats are forbidden)', () => {
    // 123.45 cannot become a BigInt minor unit — no silent truncation
    expect(() => Money.fromMinor(123.45, 'KES')).toThrow()
    expect(() => Money.fromMinor(0.5, 'USD')).toThrow()
    expect(() => Money.fromMinor('123.45', 'KES')).toThrow()
  })

  it('zero / sign helpers agree with the underlying minor units', () => {
    const zero = Money.zero('KES')
    expect(zero.isZero()).toBe(true)
    expect(zero.isNegative()).toBe(false)
    expect(zero.isPositive()).toBe(false)

    const neg = Money.fromMinor(-500n, 'KES')
    expect(neg.isNegative()).toBe(true)
    expect(neg.negated().minor).toBe(500n)
    expect(neg.abs().minor).toBe(500n)
    expect(neg.compareTo(Money.zero('KES'))).toBe(-1)
    expect(neg.lt(Money.zero('KES'))).toBe(true)
    expect(Money.fromMinor(500n, 'KES').gte(Money.fromMinor(500n, 'KES'))).toBe(true)
    expect(Money.fromMinor(500n, 'KES').gt(Money.fromMinor(500n, 'KES'))).toBe(false)
  })
})

describe('money · invalid input rejection', () => {
  it('rejects more precision than the currency supports', () => {
    // KES has 2 decimals — a third significant digit is a precision error
    expect(() => Money.fromMajor('1.234', 'KES')).toThrow(MoneyError)
    expect(() => Money.fromMajor('0.001', 'KES')).toThrow(/more precision/)
    // USDC allows 6 — 7 is too many
    expect(() => Money.fromMajor('1.2345678', 'USDC')).toThrow(/more precision/)
    // but trailing zeros beyond the precision are harmless
    expect(Money.fromMajor('1.230', 'KES').minor).toBe(123n)
  })

  it('rejects non-numeric and empty values', () => {
    for (const bad of ['abc', '', '  ', '12.34.5', '.', '-', '1,2.3.4', '12a', 'a1']) {
      let threw = false
      try {
        Money.fromMajor(bad, 'KES')
      } catch {
        threw = true
      }
      expect(threw, `fromMajor(${JSON.stringify(bad)}) should throw`).toBe(true)
    }
  })

  it('rejects unsupported currencies', () => {
    expect(() => Money.fromMajor('1.00', 'XYZ')).toThrow(/unsupported currency/)
    expect(() => Money.fromMinor(1n, 'XYZ')).toThrow(/unsupported currency/)
    expect(isCurrency('KES')).toBe(true)
    expect(isCurrency('AUD')).toBe(false)
    expect(assertCurrency('USDC')).toBe('USDC')
    expect(() => assertCurrency('AUD')).toThrow(MoneyError)
  })
})

describe('money · currency qualification', () => {
  it('add/sub throw on currency mismatch', () => {
    const kes = Money.fromMinor(100n, 'KES')
    const usd = Money.fromMinor(100n, 'USD')
    expect(() => kes.add(usd)).toThrow(/currency mismatch/)
    expect(() => kes.sub(usd)).toThrow(/currency mismatch/)
    expect(() => kes.compareTo(usd)).toThrow(/currency mismatch/)
  })

  it('add/sub are exact for matching currencies', () => {
    const a = Money.fromMinor(999999999999n, 'KES')
    const b = Money.fromMinor(1n, 'KES')
    expect(a.add(b).minor).toBe(1000000000000n) // no float saturation at 1e12
    expect(a.sub(b).minor).toBe(999999999998n)
  })

  it('Money.sum requires a non-empty same-currency sequence', () => {
    expect(() => Money.sum([])).toThrow(MoneyError)
    expect(
      Money.sum([Money.fromMinor(1n, 'KES'), Money.fromMinor(2n, 'KES'), Money.fromMinor(3n, 'KES')]).minor
    ).toBe(6n)
    expect(() => Money.sum([Money.fromMinor(1n, 'KES'), Money.fromMinor(1n, 'USD')])).toThrow(
      /currency mismatch/
    )
  })
})

describe('money · allocation invariant (parts sum EXACTLY to source)', () => {
  it('canonical splits are exact: 10/20/70', () => {
    const source = Money.fromMinor(100n, 'KES')
    const parts = source.allocatePercent([10, 20, 70])
    expect(parts.map((p) => p.minor)).toEqual([10n, 20n, 70n])
    expect(parts.reduce((a, p) => a.add(p), Money.zero('KES')).minor).toBe(100n)
  })

  it('canonical splits are exact: thirds (1/3, 1/3, 1/3)', () => {
    // equal weights need not relate to 10000 at all
    const parts = Money.fromMinor(999n, 'KES').allocateBps([1, 1, 1])
    expect(parts.map((p) => p.minor)).toEqual([333n, 333n, 333n])

    // bps thirds with an odd remainder distribute deterministically
    const parts2 = Money.fromMinor(100n, 'KES').allocateBps([3333, 3333, 3334])
    expect(parts2.map((p) => p.minor)).toEqual([33n, 33n, 34n])
    expect(parts2.reduce((a, p) => a.add(p), Money.zero('KES')).minor).toBe(100n)
  })

  it('canonical splits are exact: 7/93 and single-100%', () => {
    const parts = Money.fromMinor(999n, 'KES').allocatePercent([7, 93])
    expect(parts.map((p) => p.minor)).toEqual([70n, 929n])
    expect(parts[0].add(parts[1]).minor).toBe(999n)

    // a single 100% weight consumes everything
    const single = Money.fromMinor(999n, 'KES').allocateBps([10000])
    expect(single.map((p) => p.minor)).toEqual([999n])
  })

  it('weights need not sum to 10000 — parts still sum to the source', () => {
    // 1234+5678 = 6912 ≠ 10000
    const parts = Money.fromMinor(10000n, 'KES').allocateBps([1234, 5678])
    expect(parts.reduce((a, p) => a.add(p), Money.zero('KES')).minor).toBe(10000n)

    // 5000+2000 = 7000 of the total
    const parts2 = Money.fromMinor(999n, 'KES').allocateBps([5000, 2000])
    expect(parts2.reduce((a, p) => a.add(p), Money.zero('KES')).minor).toBe(999n)
  })

  it('odd amounts 999 and 1 allocate without rounding leakage', () => {
    for (const minor of [999n, 1n, 3n]) {
      const parts = Money.fromMinor(minor, 'KES').allocatePercent([10, 20, 70])
      expect(parts.reduce((a, p) => a.add(p), Money.zero('KES')).minor).toBe(minor)
    }
    // the indivisible single minor unit lands in the largest-weight bucket
    expect(Money.fromMinor(1n, 'KES').allocatePercent([10, 20, 70]).map((p) => p.minor)).toEqual([
      0n,
      0n,
      1n,
    ])
  })

  it('zero-weight buckets receive exactly zero', () => {
    const parts = Money.fromMinor(999n, 'KES').allocateBps([0, 20000])
    expect(parts.map((p) => p.minor)).toEqual([0n, 999n])
  })

  it('50 randomized (seeded) amounts and weight sets sum EXACTLY to source', () => {
    const rng = mulberry32(20260207)
    for (let i = 0; i < 50; i++) {
      const magnitude = randInt(rng, 0, 9)
      const minor = BigInt(randInt(rng, 0, 10 ** magnitude))
      const currency = rng() < 0.5 ? 'KES' : 'USDC'
      const source = Money.fromMinor(minor, currency)
      const weightCount = randInt(rng, 1, 6)
      const weights = Array.from({ length: weightCount }, () => randInt(rng, 1, 10000))
      const bpsParts = source.allocateBps(weights)
      expect(bpsParts.reduce((a, p) => a.add(p), Money.zero(currency)).minor).toBe(minor)

      // percent flavor on the same seeded stream
      const percents = Array.from({ length: weightCount }, () => randInt(rng, 1, 9900) / 100)
      const pctParts = source.allocatePercent(percents)
      expect(pctParts.reduce((a, p) => a.add(p), Money.zero(currency)).minor).toBe(minor)
      // parts inherit the source currency
      for (const p of [...bpsParts, ...pctParts]) expect(p.currency).toBe(currency)
    }
  })

  it('negative amounts allocate to parts that still sum exactly', () => {
    const parts = Money.fromMinor(-999n, 'KES').allocatePercent([7, 93])
    expect(parts.map((p) => p.minor)).toEqual([-69n, -930n])
    expect(parts.reduce((a, p) => a.add(p), Money.zero('KES')).minor).toBe(-999n)
    for (const p of parts) expect(p.isNegative() || p.isZero()).toBe(true)
  })

  it('zero amounts allocate to all-zero parts', () => {
    const parts = Money.zero('KES').allocatePercent([33, 33, 34])
    expect(parts.map((p) => p.minor)).toEqual([0n, 0n, 0n])
  })

  it('rejects empty, zero-total and negative-total weight sets', () => {
    expect(() => Money.fromMinor(100n, 'KES').allocateBps([])).toThrow(/at least one weight/)
    expect(() => Money.fromMinor(100n, 'KES').allocateBps([0, 0])).toThrow(/positive/)
    expect(() => Money.fromMinor(100n, 'KES').allocateBps([-5, 5])).toThrow(/positive/)
    expect(() => Money.fromMinor(100n, 'KES').allocateBps([-10, 5])).toThrow(/positive/)
  })
})

describe('money · exact formatting (never through Number)', () => {
  it('formats exact strings with symbol placement and grouping', () => {
    expect(Money.fromMajor('1234.50', 'KES').format()).toBe('KSh 1,234.50')
    expect(Money.fromMinor(1234567n, 'USDC').format()).toBe('1.234567 USDC')
    expect(Money.fromMinor(1234567n, 'USDC').formatPlain()).toBe('1.234567')
    expect(Money.fromMajor('1234567.89', 'USD').format()).toBe('$ 1,234,567.89')
    expect(Money.fromMinor(-450n, 'KES').format()).toBe('KSh -4.50')
    expect(Money.fromMinor(5n, 'KES').format()).toBe('KSh 0.05')
    expect(Money.fromMajor('0.50', 'EUR').format()).toBe('0.50 €') // symbol after
  })

  it('BigInt-scale amounts format without float degradation', () => {
    const huge = Money.fromMinor(10n ** 18n + 5n, 'KES')
    expect(huge.format()).toBe('KSh 10,000,000,000,000,000.05') // 1e18+0.05 — exact
  })

  it('convenience formatters derive from the same exact path', () => {
    expect(formatMinor(123450n, 'KES')).toBe('KSh 1,234.50')
    expect(formatSignedMinor(123450n, 'KES')).toBe('+KSh 1,234.50')
    expect(formatSignedMinor(-123450n, 'KES')).toBe('KSh -1,234.50')
  })

  it('toJSON is JSON-safe (no BigInt leaks to clients)', () => {
    const m = Money.fromMajor('1234.50', 'KES')
    const json = JSON.parse(JSON.stringify(m)) as { minor: string; currency: string; formatted: string }
    expect(json).toEqual({ minor: '123450', currency: 'KES', formatted: 'KSh 1,234.50' })
  })

  it('exposes the currency metadata table the kernel relies on', () => {
    expect(CURRENCIES.KES.minorUnits).toBe(2)
    expect(CURRENCIES.USDC.minorUnits).toBe(6)
    expect(CURRENCIES.UGX.minorUnits).toBe(0)
  })
})

describe('money · parse()', () => {
  it('parses "KES 1234.50" into exact minor units', () => {
    const m = Money.parse('KES 1234.50')
    expect(m.currency).toBe('KES')
    expect(m.minor).toBe(123450n)
  })

  it('parses prefixed codes with grouped and signed amounts', () => {
    expect(Money.parse('USDC 0.007712').minor).toBe(7712n)
    expect(Money.parse('KES 1,234.50').minor).toBe(123450n)
    expect(Money.parse('KES -25.00').minor).toBe(-2500n)
  })

  it('falls back to a given currency for bare decimal strings', () => {
    const m = Money.parse('1234.50', 'KES')
    expect(m.currency).toBe('KES')
    expect(m.minor).toBe(123450n)
  })

  it('refuses unparseable strings without a fallback', () => {
    expect(() => Money.parse('garbage')).toThrow(MoneyError)
    expect(() => Money.parse('1234.50')).toThrow(MoneyError)
  })
})
