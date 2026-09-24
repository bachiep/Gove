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
    private readonly maxBuckets: number = 10_000,
  ) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('Rate-limit limit must be a positive integer');
    }
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
      throw new Error('Rate-limit window must be a positive integer');
    }
    if (!Number.isSafeInteger(maxBuckets) || maxBuckets <= 0) {
      throw new Error('Rate-limit bucket capacity must be a positive integer');
    }
  }

  check(key: string): RateLimitDecision {
    const currentTime = this.now();
    this.reclaimExpiredBuckets(currentTime);
    const existing = this.buckets.get(key);
    const bucket =
      !existing || currentTime - existing.startedAt >= this.windowMs
        ? { startedAt: currentTime, count: 0 }
        : existing;

    bucket.count += 1;
    if (!existing) {
      this.reserveBucketCapacity();
    }
    this.buckets.set(key, bucket);
    const allowed = bucket.count <= this.limit;
    const remaining = Math.max(0, this.limit - bucket.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.startedAt + this.windowMs - currentTime) / 1000),
    );
    return { allowed, limit: this.limit, remaining, retryAfterSeconds };
  }

  private reclaimExpiredBuckets(currentTime: number): void {
    for (const [key, bucket] of this.buckets) {
      if (currentTime - bucket.startedAt >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }

  private reserveBucketCapacity(): void {
    if (this.buckets.size < this.maxBuckets) {
      return;
    }

    // Map preserves insertion order, so eviction is deterministic: remove the
    // oldest active bucket before adding a new key once capacity is reached.
    const oldestKey = this.buckets.keys().next().value;
    if (oldestKey !== undefined) {
      this.buckets.delete(oldestKey);
    }
  }
}
