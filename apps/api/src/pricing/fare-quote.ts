const BASIS_POINTS = 10_000;
const METERS_PER_KILOMETER = 1_000;
const SECONDS_PER_MINUTE = 60;

export interface FarePricingRuleSnapshot {
  version: string;
  currency: string;
  serviceType: string;
  baseFareMinor: number;
  distanceRateMinorPerKilometer: number;
  durationRateMinorPerMinute: number;
  serviceMultiplierBps: number;
  minimumSurgeMultiplierBps: number;
  maximumSurgeMultiplierBps: number;
}

export interface InitialFareQuoteInput {
  distanceMeters: number;
  durationSeconds: number;
  requestedSurgeMultiplierBps: number;
}

export interface InitialFareQuote {
  currency: string;
  baseFareMinor: number;
  distanceFareMinor: number;
  durationFareMinor: number;
  subtotalMinor: number;
  serviceMultiplierBps: number;
  serviceAdjustedFareMinor: number;
  appliedSurgeMultiplierBps: number;
  totalFareMinor: number;
  ruleSnapshot: Readonly<FarePricingRuleSnapshot>;
}

export interface FinalFare {
  currency: string;
  baseFareMinor: number;
  distanceFareMinor: number;
  durationFareMinor: number;
  subtotalMinor: number;
  serviceMultiplierBps: number;
  serviceAdjustedFareMinor: number;
  appliedSurgeMultiplierBps: number;
  totalFareMinor: number;
}

export class PricingInputError extends Error {
  readonly code = 'INVALID_PRICING_INPUT';

  constructor(message: string) {
    super(message);
    this.name = 'PricingInputError';
  }
}

/**
 * Produces an initial Fare Quote using only integer minor units and basis
 * points. Each fractional minor unit is rounded upward so the result is
 * repeatable across runtimes without floating-point currency values.
 */
export function quoteInitialFare(
  input: InitialFareQuoteInput,
  rules: FarePricingRuleSnapshot,
): InitialFareQuote {
  validateInput(input);
  validateRules(rules);

  const distanceFareMinor = ceilRatio(
    checkedMultiply(
      input.distanceMeters,
      rules.distanceRateMinorPerKilometer,
      'distance fare',
    ),
    METERS_PER_KILOMETER,
  );
  const durationFareMinor = ceilRatio(
    checkedMultiply(
      input.durationSeconds,
      rules.durationRateMinorPerMinute,
      'duration fare',
    ),
    SECONDS_PER_MINUTE,
  );
  const subtotalMinor = checkedSum(
    [rules.baseFareMinor, distanceFareMinor, durationFareMinor],
    'subtotal',
  );
  const serviceAdjustedFareMinor = applyMultiplier(
    subtotalMinor,
    rules.serviceMultiplierBps,
    'service multiplier',
  );
  const appliedSurgeMultiplierBps = clamp(
    input.requestedSurgeMultiplierBps,
    rules.minimumSurgeMultiplierBps,
    rules.maximumSurgeMultiplierBps,
  );
  const totalFareMinor = applyMultiplier(
    serviceAdjustedFareMinor,
    appliedSurgeMultiplierBps,
    'surge multiplier',
  );

  return {
    currency: rules.currency,
    baseFareMinor: rules.baseFareMinor,
    distanceFareMinor,
    durationFareMinor,
    subtotalMinor,
    serviceMultiplierBps: rules.serviceMultiplierBps,
    serviceAdjustedFareMinor,
    appliedSurgeMultiplierBps,
    totalFareMinor,
    ruleSnapshot: Object.freeze({ ...rules }),
  };
}

/**
 * Calculates the final Fare from observed demo metering and the immutable
 * pricing snapshot accepted when the Trip was quoted. The surge value is
 * clamped to the snapshot's bounds so persisted or legacy data cannot bypass
 * the pricing policy.
 */
export function calculateFinalFare(
  input: {
    distanceMeters: number;
    durationSeconds: number;
    appliedSurgeMultiplierBps: number;
  },
  rules: FarePricingRuleSnapshot,
): FinalFare {
  validateInput({
    distanceMeters: input.distanceMeters,
    durationSeconds: input.durationSeconds,
    requestedSurgeMultiplierBps: input.appliedSurgeMultiplierBps,
  });
  validateRules(rules);

  const distanceFareMinor = ceilRatio(
    checkedMultiply(
      input.distanceMeters,
      rules.distanceRateMinorPerKilometer,
      'distance fare',
    ),
    METERS_PER_KILOMETER,
  );
  const durationFareMinor = ceilRatio(
    checkedMultiply(
      input.durationSeconds,
      rules.durationRateMinorPerMinute,
      'duration fare',
    ),
    SECONDS_PER_MINUTE,
  );
  const subtotalMinor = checkedSum(
    [rules.baseFareMinor, distanceFareMinor, durationFareMinor],
    'subtotal',
  );
  const serviceAdjustedFareMinor = applyMultiplier(
    subtotalMinor,
    rules.serviceMultiplierBps,
    'service multiplier',
  );
  const appliedSurgeMultiplierBps = clamp(
    input.appliedSurgeMultiplierBps,
    rules.minimumSurgeMultiplierBps,
    rules.maximumSurgeMultiplierBps,
  );

  return {
    currency: rules.currency,
    baseFareMinor: rules.baseFareMinor,
    distanceFareMinor,
    durationFareMinor,
    subtotalMinor,
    serviceMultiplierBps: rules.serviceMultiplierBps,
    serviceAdjustedFareMinor,
    appliedSurgeMultiplierBps,
    totalFareMinor: applyMultiplier(
      serviceAdjustedFareMinor,
      appliedSurgeMultiplierBps,
      'surge multiplier',
    ),
  };
}

function validateInput(input: InitialFareQuoteInput): void {
  assertNonNegativeInteger(input.distanceMeters, 'distanceMeters');
  assertNonNegativeInteger(input.durationSeconds, 'durationSeconds');
  assertPositiveInteger(
    input.requestedSurgeMultiplierBps,
    'requestedSurgeMultiplierBps',
  );
}

function validateRules(rules: FarePricingRuleSnapshot): void {
  if (!rules.version.trim()) {
    throw new PricingInputError('rule version must not be empty');
  }

  if (!rules.currency.trim()) {
    throw new PricingInputError('currency must not be empty');
  }

  if (!rules.serviceType.trim()) {
    throw new PricingInputError('serviceType must not be empty');
  }

  assertNonNegativeInteger(rules.baseFareMinor, 'baseFareMinor');
  assertNonNegativeInteger(
    rules.distanceRateMinorPerKilometer,
    'distanceRateMinorPerKilometer',
  );
  assertNonNegativeInteger(
    rules.durationRateMinorPerMinute,
    'durationRateMinorPerMinute',
  );
  assertPositiveInteger(rules.serviceMultiplierBps, 'serviceMultiplierBps');
  assertPositiveInteger(
    rules.minimumSurgeMultiplierBps,
    'minimumSurgeMultiplierBps',
  );
  assertPositiveInteger(
    rules.maximumSurgeMultiplierBps,
    'maximumSurgeMultiplierBps',
  );

  if (rules.minimumSurgeMultiplierBps > rules.maximumSurgeMultiplierBps) {
    throw new PricingInputError(
      'minimumSurgeMultiplierBps must not exceed maximumSurgeMultiplierBps',
    );
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PricingInputError(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PricingInputError(`${name} must be a positive safe integer`);
  }
}

function applyMultiplier(
  amountMinor: number,
  multiplierBps: number,
  context: string,
): number {
  return ceilRatio(
    checkedMultiply(amountMinor, multiplierBps, context),
    BASIS_POINTS,
  );
}

function checkedMultiply(left: number, right: number, context: string): number {
  const result = left * right;

  if (!Number.isSafeInteger(result)) {
    throw new PricingInputError(`${context} exceeds safe integer precision`);
  }

  return result;
}

function checkedSum(values: readonly number[], context: string): number {
  const result = values.reduce((sum, value) => sum + value, 0);

  if (!Number.isSafeInteger(result)) {
    throw new PricingInputError(`${context} exceeds safe integer precision`);
  }

  return result;
}

function ceilRatio(numerator: number, denominator: number): number {
  return Math.ceil(numerator / denominator);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
