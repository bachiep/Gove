export const tripStates = [
  'REQUESTED',
  'MATCHING',
  'DRIVER_TO_PICKUP',
  'AT_PICKUP',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVER_AVAILABLE',
] as const;

export type TripState = (typeof tripStates)[number];

export interface TripSnapshot {
  state: TripState;
  version: number;
}

export type TripCommand = {
  type:
    | 'START_MATCHING'
    | 'ASSIGN_DRIVER'
    | 'EXHAUST_MATCHING'
    | 'MARK_AT_PICKUP'
    | 'RETRY_MATCHING'
    | 'START_TRIP'
    | 'COMPLETE_TRIP'
    | 'CANCEL';
};

type TripCommandType = TripCommand['type'];

const transitions: Readonly<
  Record<TripState, Readonly<Partial<Record<TripCommandType, TripState>>>>
> = {
  REQUESTED: { START_MATCHING: 'MATCHING', CANCEL: 'CANCELLED' },
  MATCHING: {
    ASSIGN_DRIVER: 'DRIVER_TO_PICKUP',
    EXHAUST_MATCHING: 'NO_DRIVER_AVAILABLE',
    CANCEL: 'CANCELLED',
  },
  DRIVER_TO_PICKUP: {
    MARK_AT_PICKUP: 'AT_PICKUP',
    RETRY_MATCHING: 'MATCHING',
    CANCEL: 'CANCELLED',
  },
  AT_PICKUP: {
    START_TRIP: 'IN_PROGRESS',
    CANCEL: 'CANCELLED',
  },
  IN_PROGRESS: {
    COMPLETE_TRIP: 'COMPLETED',
    CANCEL: 'CANCELLED',
  },
  COMPLETED: {},
  CANCELLED: {},
  NO_DRIVER_AVAILABLE: {},
};

export class TripTransitionError extends Error {
  readonly code = 'INVALID_TRIP_TRANSITION';

  constructor(
    readonly from: TripState,
    readonly command: TripCommandType,
  ) {
    super(`Cannot apply ${command} while trip is ${from}`);
    this.name = 'TripTransitionError';
  }
}

export class TripLifecycle {
  static apply(current: TripSnapshot, command: TripCommand): TripSnapshot {
    const nextState = transitions[current.state][command.type];

    if (!nextState) {
      throw new TripTransitionError(current.state, command.type);
    }

    return { state: nextState, version: current.version + 1 };
  }
}
