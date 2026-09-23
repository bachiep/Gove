import type {
  DriverWorkState,
  TripOfferState,
  TripState,
} from '@gove/contracts';

export type DriverReservationState =
  'ACTIVE' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';

export const terminalOfferStates = [
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'REVOKED',
] as const satisfies readonly TripOfferState[];

export const terminalTripStates = [
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVER_AVAILABLE',
] as const satisfies readonly TripState[];

export interface DispatchExpiryInput {
  readonly nowEpochMs: number;
  readonly offerExpiresAtEpochMs: number;
  readonly offerState: TripOfferState;
  readonly reservationState: DriverReservationState;
  readonly workState: DriverWorkState;
  readonly tripState: TripState;
}

export interface RetryMatchingContext {
  readonly offerState: TripOfferState;
  readonly reservationState: DriverReservationState;
  readonly workState: DriverWorkState;
  readonly tripState: TripState;
}

export interface StateTransition<TState extends string> {
  readonly from: TState;
  readonly to: TState;
}

export interface DispatchExpiryDecision {
  readonly outcome: 'NOT_DUE' | 'EXPIRED_AND_RELEASED' | 'ALREADY_TERMINAL';
  readonly offer: StateTransition<TripOfferState>;
  readonly reservation: StateTransition<DriverReservationState>;
  readonly workState: StateTransition<DriverWorkState>;
  readonly mayRetryMatching: boolean;
}

export class DispatchExpiryPolicyInputError extends Error {
  readonly code = 'INVALID_DISPATCH_EXPIRY_INPUT';

  constructor(message: string) {
    super(message);
    this.name = 'DispatchExpiryPolicyInputError';
  }
}

/**
 * Returns whether an already-resolved offer leaves its Trip eligible for the
 * next matching attempt. This is deliberately a pure policy check; the caller
 * still needs a transaction to persist the corresponding state changes.
 */
export function canRetryMatching(context: RetryMatchingContext): boolean {
  if (context.tripState !== 'MATCHING') {
    return false;
  }

  if (
    context.offerState === 'PENDING' ||
    context.offerState === 'ACCEPTED' ||
    context.reservationState === 'ACTIVE' ||
    context.reservationState === 'COMMITTED' ||
    context.workState === 'RESERVED' ||
    context.workState === 'TO_PICKUP' ||
    context.workState === 'ON_TRIP'
  ) {
    return false;
  }

  return isTerminalOfferState(context.offerState);
}

/**
 * Decides the durable state transition for an expiry worker or a late command.
 * The function has no clock or storage dependency: both the current time and
 * the persisted states are explicit inputs, making boundary behavior replayable.
 */
export function evaluateDispatchExpiry(
  input: DispatchExpiryInput,
): DispatchExpiryDecision {
  assertFinite(input.nowEpochMs, 'nowEpochMs');
  assertFinite(input.offerExpiresAtEpochMs, 'offerExpiresAtEpochMs');

  if (input.offerState !== 'PENDING') {
    return {
      outcome: 'ALREADY_TERMINAL',
      offer: unchanged(input.offerState),
      reservation: unchanged(input.reservationState),
      workState: unchanged(input.workState),
      mayRetryMatching: canRetryMatching(input),
    };
  }

  if (input.nowEpochMs < input.offerExpiresAtEpochMs) {
    return {
      outcome: 'NOT_DUE',
      offer: unchanged(input.offerState),
      reservation: unchanged(input.reservationState),
      workState: unchanged(input.workState),
      mayRetryMatching: false,
    };
  }

  const nextReservationState =
    input.reservationState === 'ACTIVE'
      ? ('EXPIRED' as const)
      : input.reservationState;
  const nextWorkState =
    input.workState === 'RESERVED' ? ('AVAILABLE' as const) : input.workState;

  return {
    outcome: 'EXPIRED_AND_RELEASED',
    offer: { from: 'PENDING', to: 'EXPIRED' },
    reservation: {
      from: input.reservationState,
      to: nextReservationState,
    },
    workState: {
      from: input.workState,
      to: nextWorkState,
    },
    mayRetryMatching: canRetryMatching({
      offerState: 'EXPIRED',
      reservationState: nextReservationState,
      workState: nextWorkState,
      tripState: input.tripState,
    }),
  };
}

export function isTerminalOfferState(state: TripOfferState): boolean {
  return terminalOfferStates.some((terminalState) => terminalState === state);
}

export function isTerminalTripState(state: TripState): boolean {
  return terminalTripStates.some((terminalState) => terminalState === state);
}

function unchanged<TState extends string>(
  state: TState,
): StateTransition<TState> {
  return { from: state, to: state };
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new DispatchExpiryPolicyInputError(`${name} must be a finite number`);
  }
}
