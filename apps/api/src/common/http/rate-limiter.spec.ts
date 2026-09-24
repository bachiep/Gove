import { describe, expect, it } from 'vitest';

import { InMemoryRateLimiter } from './rate-limiter.js';

describe('InMemoryRateLimiter', () => {
  it('allows up to the configured limit and reports retry metadata', () => {
    let now = 10_000;
    const limiter = new InMemoryRateLimiter(2, 5_000, () => now);

    expect(limiter.check('client').allowed).toBe(true);
    expect(limiter.check('client')).toMatchObject({
      allowed: true,
      remaining: 0,
      limit: 2,
    });
    expect(limiter.check('client')).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 5,
    });

    now += 5_000;
    expect(limiter.check('client')).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it('keeps independent keys isolated', () => {
    const limiter = new InMemoryRateLimiter(1, 1_000, () => 10);

    expect(limiter.check('first').allowed).toBe(true);
    expect(limiter.check('first').allowed).toBe(false);
    expect(limiter.check('second').allowed).toBe(true);
  });

  it('reclaims expired buckets before handling a new key', () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter(1, 1_000, () => now, 3);

    limiter.check('first');
    limiter.check('second');
    expect(bucketKeys(limiter)).toEqual(['first', 'second']);

    now = 1_000;
    limiter.check('third');

    expect(bucketKeys(limiter)).toEqual(['third']);
  });

  it('bounds active buckets by deterministically evicting the oldest key', () => {
    const limiter = new InMemoryRateLimiter(1, 10_000, () => 0, 2);

    limiter.check('first');
    limiter.check('second');
    limiter.check('third');

    expect(bucketKeys(limiter)).toEqual(['second', 'third']);
    expect(limiter.check('first')).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });
});

function bucketKeys(limiter: InMemoryRateLimiter): string[] {
  return [
    ...(limiter as unknown as { buckets: Map<string, unknown> }).buckets.keys(),
  ];
}
