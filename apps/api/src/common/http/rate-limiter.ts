export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  startedAt: number;
  count: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('Rate-limit limit must be a positive integer');
    }
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
      throw new Error('Rate-limit window must be a positive integer');
    }
  }

  check(key: string): RateLimitDecision {
    const currentTime = this.now();
    const existing = this.buckets.get(key);
    const bucket =
      !existing || currentTime - existing.startedAt >= this.windowMs
        ? { startedAt: currentTime, count: 0 }
        : existing;

    bucket.count += 1;
    this.buckets.set(key, bucket);
    const allowed = bucket.count <= this.limit;
    const remaining = Math.max(0, this.limit - bucket.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.startedAt + this.windowMs - currentTime) / 1000),
    );
    return { allowed, limit: this.limit, remaining, retryAfterSeconds };
  }
}
