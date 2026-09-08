/**
 * src/lib/fx — pure rate-math unit tests (no database).
 *
 * Rates are scaled integers (rate × 10^8) and conversion is scale-aware:
 * converting between currencies with different minor-unit scales (KES 2 →
 * USDC 6) adjusts by the power-of-ten difference. All math is BigInt with
 * half-up rounding — never floats.
 */
import { describe, expect, it } from 'vitest'
import { applySpread, convertMinor, scaledRate } from '@/lib/fx'
import { Money } from '@novera/money'

const E8 = 100_000_000n

describe('fx · scaledRate (quote per base at 1e8 scale)', () => {
  it('KES → USD ≈ 0.0077429 (1 / 129.15) as an exact scaled integer', () => {
    const rate = scaledRate('KES', 'USD')
    // exact integer quotient: (1e8 × 1e8) / 12915000000
    expect(rate).toBe(774293n)
    // and it really is the KES→USD rate, not a 100× error
    const asDecimal = Number(rate) / 1e8
    expect(asDecimal).toBeCloseTo(1 / 129.15, 6)
    expect(asDecimal).toBeGreaterThan(0.0077)
    expect(asDecimal).toBeLessThan(0.0078)
  })

  it('USD → KES is the direct rate', () => {
    expect(scaledRate('USD', 'KES')).toBe(12_915_000_000n) // 129.15 × 1e8
  })

  it('identity pairs are exactly 1.0', () => {
    expect(scaledRate('USD', 'USD')).toBe(E8)
    expect(scaledRate('USDC', 'USDC')).toBe(E8)
    expect(scaledRate('KES', 'KES')).toBe(E8)
  })

  it('round-trips are consistent (base→quote→base scale-compensated)', () => {
    const kesPerUsd = scaledRate('USD', 'KES')
    const usdPerKes = scaledRate('KES', 'USD')
    // product of the two scaled rates ≈ 1e16 (each is ×1e8)
    expect((usdPerKes * kesPerUsd) / (E8 * E8)).toBeLessThanOrEqual(E8)
  })

  it('unknown currencies fall back to parity, not an error', () => {
    expect(scaledRate('ZZZ', 'USD')).toBe(E8)
    expect(scaledRate('USD', 'ZZZ')).toBe(E8)
  })
})

describe('fx · applySpread (the house takes its cut)', () => {
  it('spread strictly reduces the rate', () => {
    const raw = scaledRate('KES', 'USD')
    const executable = applySpread(raw, 80)
    expect(executable).toBe(768099n) // raw − floor(raw×80/10000)
    expect(executable < raw).toBe(true)
  })

  it('spread 0 is a no-op; spread 10000 consumes everything', () => {
    expect(applySpread(774293n, 0)).toBe(774293n)
    expect(applySpread(E8, 10_000)).toBe(0n)
    expect(applySpread(E8, 50)).toBe(99_500_000n)
  })

  it('truncation is toward zero (integer bps math)', () => {
    // 773900 × 80 / 10000 = 6191.2 → subtract 6191
    expect(applySpread(773_900n, 80)).toBe(767_709n)
  })
})

describe('fx · convertMinor (scale-aware, half-up, exact BigInt)', () => {
  it('KES (2 decimals) → USDC (6 decimals) grows the minor units by 10^4', () => {
    // KSh 1.00 at a 1.0 rate is exactly 1.000000 USDC
    expect(convertMinor(100n, 'KES', E8, 'USDC')).toBe(1_000_000n)
    // and the reverse shrinks back
    expect(convertMinor(1_000_000n, 'USDC', E8, 'KES')).toBe(100n)
  })

  it('same-scale conversion is a pure rate application', () => {
    expect(convertMinor(123_450n, 'KES', E8, 'KES')).toBe(123_450n)
    // KSh 1,000.00 at the KES→USD rate 0.00774293 → $7.74 (774.293 half-up)
    expect(convertMinor(100_000n, 'KES', 774_293n, 'USD')).toBe(774n)
  })

  it('cross-scale conversion with a real rate', () => {
    // KSh 1,234.50 → USDC at 0.00774293: 9,558,647.085 minor → 9,558,647
    expect(convertMinor(123_450n, 'KES', 774_293n, 'USDC')).toBe(9_558_647n)
  })

  it('rounding is half-up (away from zero at the midpoint)', () => {
    // 1 KES minor at rate 0.5 → exactly 0.5 USD minor → rounds UP
    expect(convertMinor(1n, 'KES', 50_000_000n, 'USD')).toBe(1n)
    // one under the midpoint stays down
    expect(convertMinor(1n, 'KES', 49_999_999n, 'USD')).toBe(0n)
  })

  it('UGX (0 decimals) participates in scale adjustment', () => {
    // USh 1,000 whole shillings (minor == major at 0 decimals) at 1.0
    // → 1000 USDC major = 1,000,000,000 USDC minor (scale diff 10^6)
    expect(convertMinor(1000n, 'UGX', E8, 'USDC')).toBe(1_000_000_000n)
    expect(convertMinor(1_000_000_000n, 'USDC', E8, 'UGX')).toBe(1000n)
  })

  it('agrees with Money.applyScaledRate on same-scale pairs', () => {
    const rate = scaledRate('KES', 'USD')
    const viaMoney = Money.fromMinor(123_450n, 'KES').applyScaledRate(rate).minor
    const viaFx = convertMinor(123_450n, 'KES', rate, 'USD')
    expect(viaFx).toBe(viaMoney)
  })
})
