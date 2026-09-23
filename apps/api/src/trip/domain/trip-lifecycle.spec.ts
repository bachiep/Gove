import { describe, expect, it } from 'vitest';

import {
  TripLifecycle,
  TripTransitionError,
  type TripCommand,
  type TripState,
} from './trip-lifecycle.js';

describe('TripLifecycle', () => {
  const allowedTransitions: ReadonlyArray<
    readonly [TripState, TripCommand['type'], TripState]
  > = [
    ['REQUESTED', 'START_MATCHING', 'MATCHING'],
    ['REQUESTED', 'CANCEL', 'CANCELLED'],
    ['MATCHING', 'ASSIGN_DRIVER', 'DRIVER_TO_PICKUP'],
    ['MATCHING', 'EXHAUST_MATCHING', 'NO_DRIVER_AVAILABLE'],
    ['MATCHING', 'CANCEL', 'CANCELLED'],
    ['DRIVER_TO_PICKUP', 'MARK_AT_PICKUP', 'AT_PICKUP'],
    ['DRIVER_TO_PICKUP', 'RETRY_MATCHING', 'MATCHING'],
    ['DRIVER_TO_PICKUP', 'CANCEL', 'CANCELLED'],
    ['AT_PICKUP', 'START_TRIP', 'IN_PROGRESS'],
    ['AT_PICKUP', 'CANCEL', 'CANCELLED'],
    ['IN_PROGRESS', 'COMPLETE_TRIP', 'COMPLETED'],
    ['IN_PROGRESS', 'CANCEL', 'CANCELLED'],
  ];

  it.each(allowedTransitions)(
    'applies %s + %s -> %s and increments the version',
    (from, command, to) => {
      expect(
        TripLifecycle.apply({ state: from, version: 7 }, { type: command }),
      ).toEqual({ state: to, version: 8 });
    },
  );

  it('rejects a command that is invalid for the current state', () => {
    expect(() => {
      TripLifecycle.apply(
        { state: 'DRIVER_TO_PICKUP', version: 8 },
        { type: 'ASSIGN_DRIVER' },
      );
    }).toThrowError(
      new TripTransitionError('DRIVER_TO_PICKUP', 'ASSIGN_DRIVER'),
    );
  });

  it.each<TripState>(['COMPLETED', 'CANCELLED', 'NO_DRIVER_AVAILABLE'])(
    'rejects every command once the trip is terminal in %s',
    (state) => {
      const commands: TripCommand['type'][] = [
        'START_MATCHING',
        'ASSIGN_DRIVER',
        'EXHAUST_MATCHING',
        'MARK_AT_PICKUP',
        'RETRY_MATCHING',
        'START_TRIP',
        'COMPLETE_TRIP',
        'CANCEL',
      ];

      for (const type of commands) {
        expect(() =>
          TripLifecycle.apply({ state, version: 8 }, { type }),
        ).toThrowError(TripTransitionError);
      }
    },
  );
});
