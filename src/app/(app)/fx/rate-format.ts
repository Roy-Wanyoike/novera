/**
 * Exact scaled-rate → decimal string formatting.
 *
 * Rates are stored as scaled integers (rate × 10^8) — never floats.
 * This helper divides the scaled BigInt by 10^8 with manual decimal
 * placement and half-up rounding, entirely in integer math. Shared by
 * the server rate board and the client quote panel.
 */

export function formatScaledRate(
  rateScaled: bigint | string,
  scale = 8,
  dp = 6
): string {
  const value = typeof rateScaled === 'string' ? BigInt(rateScaled) : rateScaled
  const factor = BigInt(10) ** BigInt(scale)
  const dpFactor = BigInt(10) ** BigInt(dp)
  // half-up rounding to dp decimals, exact integer arithmetic
  const rounded = (value * dpFactor * BigInt(2) + factor) / (factor * BigInt(2))
  const negative = rounded < BigInt(0)
  const abs = negative ? -rounded : rounded
  const s = abs.toString().padStart(dp + 1, '0')
  const intPart = s.slice(0, s.length - dp)
  const fracPart = s.slice(s.length - dp)
  return `${negative ? '-' : ''}${intPart}.${fracPart}`
}
