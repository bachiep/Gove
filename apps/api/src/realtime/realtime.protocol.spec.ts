import { describe, expect, it } from 'vitest';

import { realtimeClientMessageSchema } from './realtime.protocol.js';

describe('realtimeClientMessageSchema', () => {
  it('accepts authentication, mixed aggregate subscription, ping, and valid location messages', () => {
    expect(
      realtimeClientMessageSchema.safeParse({
        type: 'authenticate',
        accessToken: 'a'.repeat(20),
      }).success,
    ).toBe(true);
    expect(
      realtimeClientMessageSchema.safeParse({
        type: 'subscribe',
        tripIds: ['00000000-0000-4000-8000-000000000001'],
        deliveryIds: ['00000000-0000-4000-8000-000000000002'],
      }).success,
    ).toBe(true);
    expect(
      realtimeClientMessageSchema.safeParse({ type: 'ping' }).success,
    ).toBe(true);
    expect(
      realtimeClientMessageSchema.safeParse({
        type: 'location',
        location: {
          latitude: 21.0285,
          longitude: 105.8048,
          accuracyMeters: 4,
          sequenceNumber: 1,
        },
      }).success,
    ).toBe(true);
  });

  it('rejects unbounded subscriptions and invalid coordinates', () => {
    expect(
      realtimeClientMessageSchema.safeParse({
        type: 'subscribe',
        tripIds: Array.from(
          { length: 21 },
          () => '00000000-0000-4000-8000-000000000001',
        ),
      }).success,
    ).toBe(false);
    expect(
      realtimeClientMessageSchema.safeParse({
        type: 'subscribe',
        tripIds: [],
        deliveryIds: [],
      }).success,
    ).toBe(false);
    expect(
      realtimeClientMessageSchema.safeParse({
        type: 'location',
        location: {
          latitude: 91,
          longitude: 105.8048,
          accuracyMeters: 4,
          sequenceNumber: 1,
        },
      }).success,
    ).toBe(false);
  });
});
