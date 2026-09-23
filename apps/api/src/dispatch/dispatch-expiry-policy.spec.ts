import { describe, expect, it } from 'vitest';

import {
  canRetryMatching,
  evaluateDispatchExpiry,
  isTerminalOfferState,
  isTerminalTripState,
} from './dispatch-expiry-policy.js';

const dueAt = 1_000;

describe('dispatch expiry policy', () => {
  it('expires a pending offer, releases its reservation and work state, and permits retry', () => {
    expect(
      evaluateDispatchExpiry({
        nowEpochMs: dueAt,
        offerExpiresAtEpochMs: dueAt,
        offerState: 'PENDING',
        reservationState: 'ACTIVE',
        workState: 'RESERVED',
        tripState: 'MATCHING',
      }),
    ).toEqual({
      outcome: 'EXPIRED_AND_RELEASED',
      offer: { from: 'PENDING', to: 'EXPIRED' },
      reservation: { from: 'ACTIVE', to: 'EXPIRED' },
      workState: { from: 'RESERVED', to: 'AVAILABLE' },
      mayRetryMatching: true,
    });
  });

  it('does not expire an offer before its deadline', () => {
    expect(
      evaluateDispatchExpiry({
        nowEpochMs: dueAt - 1,
        offerExpiresAtEpochMs: dueAt,
        offerState: 'PENDING',
        reservationState: 'ACTIVE',
        workState: 'RESERVED',
        tripState: 'MATCHING',
      }),
    ).toEqual({
      outcome: 'NOT_DUE',
      offer: { from: 'PENDING', to: 'PENDING' },
      reservation: { from: 'ACTIVE', to: 'ACTIVE' },
      workState: { from: 'RESERVED', to: 'RESERVED' },
      mayRetryMatching: false,
    });
  });

  it.each(['COMPLETED', 'CANCELLED', 'NO_DRIVER_AVAILABLE'] as const)(
    'releases an expired offer but blocks retry for terminal Trip state %s',
    (tripState) => {
      const decision = evaluateDispatchExpiry({
        nowEpochMs: dueAt,
        offerExpiresAtEpochMs: dueAt,
        offerState: 'PENDING',
        reservationState: 'ACTIVE',
        workState: 'RESERVED',
        tripState,
      });

      expect(decision.outcome).toBe('EXPIRED_AND_RELEASED');
      expect(decision.mayRetryMatching).toBe(false);
      expect(isTerminalTripState(tripState)).toBe(true);
    },
  );

  it('treats an already expired offer as terminal and makes replay idempotent', () => {
    const input = {
      nowEpochMs: dueAt + 10,
      offerExpiresAtEpochMs: dueAt,
      offerState: 'EXPIRED' as const,
      reservationState: 'EXPIRED' as const,
      workState: 'AVAILABLE' as const,
      tripState: 'MATCHING' as const,
    };

    expect(evaluateDispatchExpiry(input)).toEqual({
      outcome: 'ALREADY_TERMINAL',
      offer: { from: 'EXPIRED', to: 'EXPIRED' },
      reservation: { from: 'EXPIRED', to: 'EXPIRED' },
      workState: { from: 'AVAILABLE', to: 'AVAILABLE' },
      mayRetryMatching: true,
    });
    expect(isTerminalOfferState(input.offerState)).toBe(true);
  });

  it('never permits matching retry after an accepted offer or terminal Trip', () => {
    expect(
      canRetryMatching({
        offerState: 'ACCEPTED',
        reservationState: 'COMMITTED',
        workState: 'TO_PICKUP',
        tripState: 'DRIVER_TO_PICKUP',
      }),
    ).toBe(false);

    expect(
      canRetryMatching({
        offerState: 'EXPIRED',
        reservationState: 'EXPIRED',
        workState: 'AVAILABLE',
        tripState: 'CANCELLED',
      }),
    ).toBe(false);
  });

  it('rejects non-finite timestamps instead of making a nondeterministic decision', () => {
    expect(() =>
      evaluateDispatchExpiry({
        nowEpochMs: Number.NaN,
        offerExpiresAtEpochMs: dueAt,
        offerState: 'PENDING',
        reservationState: 'ACTIVE',
        workState: 'RESERVED',
        tripState: 'MATCHING',
      }),
    ).toThrow('nowEpochMs must be a finite number');
  });
});
