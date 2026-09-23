export interface DriverCandidate {
  readonly driverId: string;
  readonly distanceMeters: number;
  readonly freshnessAgeSeconds: number;
  readonly eligible: boolean;
}

export interface DispatchRankingOptions {
  readonly maxFreshnessAgeSeconds: number;
}

export class DispatchRankingInputError extends Error {
  readonly code = 'INVALID_DISPATCH_RANKING_INPUT';

  constructor(message: string) {
    super(message);
    this.name = 'DispatchRankingInputError';
  }
}

/**
 * Returns fresh, eligible Driver candidates in deterministic dispatch order.
 * Stale candidates are those older than the configured freshness threshold.
 */
export function rankEligibleDriverCandidates(
  candidates: readonly DriverCandidate[],
  options: DispatchRankingOptions,
): DriverCandidate[] {
  validateOptions(options);

  candidates.forEach(validateCandidate);

  return candidates
    .filter(
      (candidate) =>
        candidate.eligible &&
        candidate.freshnessAgeSeconds <= options.maxFreshnessAgeSeconds,
    )
    .toSorted(compareCandidates);
}

function compareCandidates(
  left: DriverCandidate,
  right: DriverCandidate,
): number {
  return (
    left.distanceMeters - right.distanceMeters ||
    left.freshnessAgeSeconds - right.freshnessAgeSeconds ||
    compareDriverIds(left.driverId, right.driverId)
  );
}

function compareDriverIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function validateOptions(options: DispatchRankingOptions): void {
  assertNonNegativeFiniteNumber(
    options.maxFreshnessAgeSeconds,
    'maxFreshnessAgeSeconds',
  );
}

function validateCandidate(candidate: DriverCandidate): void {
  if (!candidate.driverId.trim()) {
    throw new DispatchRankingInputError('driverId must not be empty');
  }

  assertNonNegativeFiniteNumber(candidate.distanceMeters, 'distanceMeters');
  assertNonNegativeFiniteNumber(
    candidate.freshnessAgeSeconds,
    'freshnessAgeSeconds',
  );

  if (typeof candidate.eligible !== 'boolean') {
    throw new DispatchRankingInputError('eligible must be a boolean');
  }
}

function assertNonNegativeFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new DispatchRankingInputError(
      `${name} must be a non-negative finite number`,
    );
  }
}
