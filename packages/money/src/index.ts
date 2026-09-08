/**
 * @novera/money — Deterministic money arithmetic.
 *
 * Design rules (financial kernel directive):
 *  - Amounts are ALWAYS integer minor units (BigInt). Floats are forbidden.
 *  - A Money value is always currency-qualified. KES + USD throws.
 *  - Allocation (splits) uses the largest-remainder method so the parts
 *    always sum exactly to the original — no rounding leakage, ever.
 *  - Formatting is performed from the exact BigInt — never through Number.
 */

export type CurrencyCode =
  | 'KES'
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'NGN'
  | 'TZS'
  | 'UGX'
  | 'ZAR'
  | 'USDC'

export interface CurrencyMeta {
  code: CurrencyCode
  minorUnits: 0 | 2 | 6
  symbol: string
  name: string
  symbolBefore: boolean
}

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  KES: { code: 'KES', minorUnits: 2, symbol: 'KSh', name: 'Kenyan Shilling', symbolBefore: true },
  USD: { code: 'USD', minorUnits: 2, symbol: '$', name: 'US Dollar', symbolBefore: true },
  EUR: { code: 'EUR', minorUnits: 2, symbol: '€', name: 'Euro', symbolBefore: false },
  GBP: { code: 'GBP', minorUnits: 2, symbol: '£', name: 'British Pound', symbolBefore: true },
  NGN: { code: 'NGN', minorUnits: 2, symbol: '₦', name: 'Nigerian Naira', symbolBefore: true },
  TZS: { code: 'TZS', minorUnits: 2, symbol: 'TSh', name: 'Tanzanian Shilling', symbolBefore: true },
  UGX: { code: 'UGX', minorUnits: 0, symbol: 'USh', name: 'Ugandan Shilling', symbolBefore: true },
  ZAR: { code: 'ZAR', minorUnits: 2, symbol: 'R', name: 'South African Rand', symbolBefore: true },
  USDC: { code: 'USDC', minorUnits: 6, symbol: 'USDC', name: 'USD Coin', symbolBefore: false },
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(`[money] ${message}`)
    this.name = 'MoneyError'
  }
}

export function isCurrency(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code)
}

export function assertCurrency(code: string): CurrencyCode {
  if (!isCurrency(code)) throw new MoneyError(`unsupported currency: ${code}`)
  return code
}

function groupThousands(intPart: string): string {
  let out = ''
  let count = 0
  for (let i = intPart.length - 1; i >= 0; i--) {
    out = intPart[i] + out
    count++
    if (count % 3 === 0 && i > 0) out = ',' + out
  }
  return out
}

function exactDecimalString(minor: bigint, minorUnits: number): string {
  const negative = minor < 0n
  const abs = negative ? -minor : minor
  const s = abs.toString().padStart(minorUnits + 1, '0')
  const intPart = minorUnits === 0 ? s : s.slice(0, s.length - minorUnits)
  const fracPart = minorUnits === 0 ? '' : s.slice(s.length - minorUnits)
  let out = groupThousands(intPart)
  if (fracPart) out += '.' + fracPart
  return (negative ? '-' : '') + out
}

export class Money {
  readonly minor: bigint
  readonly currency: CurrencyCode

  private constructor(minor: bigint, currency: CurrencyCode) {
    this.minor = minor
    this.currency = currency
  }

  static fromMinor(minor: bigint | number | string, currency: string): Money {
    const code = assertCurrency(currency)
    const b = typeof minor === 'bigint' ? minor : BigInt(minor)
    if (typeof minor === 'number' && !Number.isInteger(minor)) {
      throw new MoneyError('fromMajor() must be used for decimal values')
    }
    return new Money(b, code)
  }

  static zero(currency: string): Money {
    return Money.fromMinor(0n, currency)
  }

  /** Parse a decimal string like "1234.50" or "0.007712" without floats. */
  static fromMajor(value: string | number, currency: string): Money {
    assertCurrency(currency)
    const meta = CURRENCIES[currency as CurrencyCode]
    const raw = String(value).trim().replace(/,/g, '')
    if (!/^-?\d*(\.\d*)?$/.test(raw) || raw === '' || raw === '.' || raw === '-') {
      throw new MoneyError(`invalid decimal value: ${value}`)
    }
    const negative = raw.startsWith('-')
    const unsigned = negative ? raw.slice(1) : raw
    const [intRaw = '0', fracRaw = ''] = unsigned.split('.')
    const fracPadded = fracRaw.slice(0, meta.minorUnits).padEnd(meta.minorUnits, '0')
    if (fracRaw.length > meta.minorUnits && !fracRaw.slice(meta.minorUnits).split('').every((c) => c === '0')) {
      throw new MoneyError(
        `${value} has more precision than ${currency} supports (${meta.minorUnits} decimals)`
      )
    }
    const digits = (intRaw === '' ? '0' : intRaw) + fracPadded
    const b = BigInt(digits) * (negative ? -1n : 1n)
    return new Money(b, meta.code)
  }

  /** Parse "KES 1234.50" / "KSh 9,999" style strings. */
  static parse(formatted: string, fallbackCurrency?: string): Money {
    const trimmed = formatted.trim()
    const match = trimmed.match(/^([A-Za-z]{3,4})\s+([-\d.,]+)$/)
    if (match) {
      return Money.fromMajor(match[2], match[1].toUpperCase())
    }
    if (!fallbackCurrency) throw new MoneyError(`cannot parse money string: ${formatted}`)
    return Money.fromMajor(trimmed, fallbackCurrency)
  }

  private assertSame(other: Money): void {
    if (other.currency !== this.currency) {
      throw new MoneyError(`currency mismatch: ${this.currency} vs ${other.currency}`)
    }
  }

  add(other: Money): Money {
    this.assertSame(other)
    return new Money(this.minor + other.minor, this.currency)
  }

  sub(other: Money): Money {
    this.assertSame(other)
    return new Money(this.minor - other.minor, this.currency)
  }

  isZero(): boolean { return this.minor === 0n }
  isNegative(): boolean { return this.minor < 0n }
  isPositive(): boolean { return this.minor > 0n }
  negated(): Money { return new Money(-this.minor, this.currency) }
  abs(): Money { return new Money(this.minor < 0n ? -this.minor : this.minor, this.currency) }

  compareTo(other: Money): number {
    this.assertSame(other)
    return this.minor === other.minor ? 0 : this.minor < other.minor ? -1 : 1
  }

  gte(other: Money): boolean { return this.compareTo(other) >= 0 }
  lte(other: Money): boolean { return this.compareTo(other) <= 0 }
  gt(other: Money): boolean { return this.compareTo(other) > 0 }
  lt(other: Money): boolean { return this.compareTo(other) < 0 }

  /**
   * Apply a scaled integer rate (e.g. FX rate × 10^rateScale) exactly,
   * with half-up rounding (away from zero) on the remainder.
   */
  applyScaledRate(rateScaled: bigint, rateScale = 8): Money {
    const product = this.minor * rateScaled
    const divisor = 10n ** BigInt(rateScale)
    const quotient = product / divisor
    const remainder = product % divisor
    const half = divisor / 2n
    let out = quotient
    if (remainder >= half) out += 1n
    if (remainder <= -half) out -= 1n
    return new Money(out, this.currency)
  }

  /**
   * Allocate by basis-point weights using largest-remainder.
   * Parts ALWAYS sum to exactly this amount. Weights need not sum to 10000.
   */
  allocateBps(weightsBps: number[]): Money[] {
    if (weightsBps.length === 0) throw new MoneyError('allocate requires at least one weight')
    const total = weightsBps.reduce((a, b) => a + b, 0)
    if (total <= 0) throw new MoneyError('allocate weights must be positive')
    const totalBps = BigInt(total)
    const parts: bigint[] = []
    const remainders: { index: number; value: bigint }[] = []
    let allocated = 0n
    for (const w of weightsBps) {
      const exact = (this.minor * BigInt(w)) / totalBps
      parts.push(exact)
      remainders.push({ index: parts.length - 1, value: (this.minor * BigInt(w)) % totalBps })
      allocated += exact
    }
    let leftover = this.minor - allocated
    // distribute remainder to largest fractional parts (deterministic tie-break by index)
    remainders.sort((a, b) => (b.value === a.value ? a.index - b.index : b.value > a.value ? 1 : -1))
    let i = 0
    while (leftover > 0n) {
      parts[remainders[i % remainders.length].index] += 1n
      leftover -= 1n
      i++
    }
    while (leftover < 0n) {
      parts[remainders[i % remainders.length].index] -= 1n
      leftover += 1n
      i++
    }
    return parts.map((p) => new Money(p, this.currency))
  }

  /** True percent split, e.g. [10, 20, 70] — same as allocateBps(×100). */
  allocatePercent(percents: number[]): Money[] {
    return this.allocateBps(percents.map((p) => Math.round(p * 100)))
  }

  format(): string {
    const meta = CURRENCIES[this.currency]
    const dec = exactDecimalString(this.minor, meta.minorUnits)
    return meta.symbolBefore ? `${meta.symbol} ${dec}` : `${dec} ${meta.symbol}`
  }

  formatPlain(): string {
    const meta = CURRENCIES[this.currency]
    return exactDecimalString(this.minor, meta.minorUnits)
  }

  toMajorString(): string {
    return this.formatPlain()
  }

  toString(): string {
    return `${this.currency} ${this.formatPlain()}`
  }

  /** JSON-safe representation — BigInt is not JSON-serializable. */
  toJSON(): { minor: string; currency: CurrencyCode; formatted: string } {
    return { minor: this.minor.toString(), currency: this.currency, formatted: this.format() }
  }

  static sum(values: Money[]): Money {
    if (values.length === 0) throw new MoneyError('sum of empty sequence requires currency — use Money.zero')
    return values.reduce((acc, m) => acc.add(m))
  }
}

/** Convenience: format raw minor units + currency code without constructing Money. */
export function formatMinor(minor: bigint | number | string, currency: string): string {
  return Money.fromMinor(minor, currency).format()
}

export function minorToMajorString(minor: bigint | number | string, currency: string): string {
  return Money.fromMinor(minor, currency).toMajorString()
}

/** Signed zero-safe display helper for deltas. */
export function formatSignedMinor(minor: bigint | number | string, currency: string): string {
  const m = Money.fromMinor(minor, currency)
  const sign = m.isPositive() ? '+' : ''
  return `${sign}${m.format()}`
}
