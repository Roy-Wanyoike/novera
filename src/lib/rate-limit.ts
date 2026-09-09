/**
 * Shared fixed-window rate limiter (in-memory).
 *
 * Reference build: per-process Map — the limiter resets on restart, which
 * is acceptable for brute-force throttling combined with audit trails.
 * Production target: Redis-backed token bucket shared across instances.
 *
 * Semantics: a bucket keyed by `key` holds {count, resetAt}. The window is
 * FIXED (not sliding): the bucket resets wholesale when resetAt passes.
 */

interface Bucket {
  count: number
  resetAt: number
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /**
   * Record an attempt against `key` and report whether it is allowed.
   * `retryInMs` tells the caller how long until the window resets.
   * (Counting semantics: the Nth attempt is blocked once `limit` attempts
   * were already recorded in this window.)
   */
  check(key: string): { allowed: boolean; retryInMs: number } {
    const now = Date.now()
    const bucket = this.buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs })
      return { allowed: 1 <= this.limit, retryInMs: this.windowMs }
    }
    bucket.count++
    return { allowed: bucket.count <= this.limit, retryInMs: bucket.resetAt - now }
  }

  /**
   * Read-only check: is the key currently allowed WITHOUT recording an
   * attempt? Use when only failures should count (e.g. login throttle —
   * check first, then `record` only on failure).
   */
  peek(key: string): { allowed: boolean; retryInMs: number } {
    const now = Date.now()
    const bucket = this.buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      return { allowed: true, retryInMs: this.windowMs }
    }
    return { allowed: bucket.count < this.limit, retryInMs: bucket.resetAt - now }
  }

  /** Record one counted event (failure) against `key`. */
  record(key: string): void {
    const now = Date.now()
    const bucket = this.buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs })
      return
    }
    bucket.count++
  }

  /** Clear a key's window (e.g. after a successful login). */
  reset(key: string): void {
    this.buckets.delete(key)
  }
}

/** Periodically drop expired buckets so the Map cannot grow unboundedly. */
export function pruneRateBuckets(buckets: Map<string, Bucket>): void {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}
