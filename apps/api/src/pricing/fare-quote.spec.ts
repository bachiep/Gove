import { describe, expect, it } from 'vitest';

import {
  calculateFinalFare,
  PricingInputError,
  quoteInitialFare,
  type FarePricingRuleSnapshot,
} from './fare-quote.js';

const standardMotorbikeRules: FarePricingRuleSnapshot = {
  version: '2026-09-mvp-v1',
  currency: 'VND',
  serviceType: 'MOTORBIKE_STANDARD',
  baseFareMinor: 12_000,
  distanceRateMinorPerKilometer: 6_800,
  durationRateMinorPerMinute: 350,
  serviceMultiplierBps: 10_500,
  minimumSurgeMultiplierBps: 10_000,
  maximumSurgeMultiplierBps: 15_000,
};

describe('quoteInitialFare', () => {
  it('produces a deterministic integer-minor-unit quote with its rule snapshot', () => {
    expect(
      quoteInitialFare(
        {
          distanceMeters: 2_500,
          durationSeconds: 420,
          requestedSurgeMultiplierBps: 12_000,
        },
        standardMotorbikeRules,
      ),
    ).toEqual({
      currency: 'VND',
      baseFareMinor: 12_000,
      distanceFareMinor: 17_000,
      durationFareMinor: 2_450,
      subtotalMinor: 31_450,
      serviceMultiplierBps: 10_500,
      serviceAdjustedFareMinor: 33_023,
      appliedSurgeMultiplierBps: 12_000,
      totalFareMinor: 39_628,
      ruleSnapshot: standardMotorbikeRules,
    });
  });

  it.each([
    [9_000, 10_000],
    [18_000, 15_000],
  ])(
    'clamps requested surge %i to the configured bound %i',
    (requestedSurgeMultiplierBps, appliedSurgeMultiplierBps) => {
      expect(
        quoteInitialFare(
          {
            distanceMeters: 1_000,
            durationSeconds: 60,
            requestedSurgeMultiplierBps,
          },
          standardMotorbikeRules,
        ).appliedSurgeMultiplierBps,
      ).toBe(appliedSurgeMultiplierBps);
    },
  );

  it('rounds fractional distance and duration minor units upward', () => {
    expect(
      quoteInitialFare(
        {
          distanceMeters: 1,
          durationSeconds: 1,
          requestedSurgeMultiplierBps: 10_000,
        },
        {
          ...standardMotorbikeRules,
          baseFareMinor: 0,
          distanceRateMinorPerKilometer: 1,
          durationRateMinorPerMinute: 1,
          serviceMultiplierBps: 10_000,
        },
      ),
    ).toMatchObject({
      distanceFareMinor: 1,
      durationFareMinor: 1,
      totalFareMinor: 2,
    });
  });

  it('does not mutate the supplied rules and returns an independent snapshot', () => {
    const rules = { ...standardMotorbikeRules };

    const quote = quoteInitialFare(
      {
        distanceMeters: 1_000,
        durationSeconds: 60,
        requestedSurgeMultiplierBps: 10_000,
      },
      rules,
    );

    expect(rules).toEqual(standardMotorbikeRules);

    rules.baseFareMinor = 1;

    expect(quote.ruleSnapshot.baseFareMinor).toBe(12_000);
  });

  it('rejects non-integer or negative metering values', () => {
    expect(() =>
      quoteInitialFare(
        {
          distanceMeters: -1,
          durationSeconds: 60,
          requestedSurgeMultiplierBps: 10_000,
        },
        standardMotorbikeRules,
      ),
    ).toThrowError(PricingInputError);

    expect(() =>
      quoteInitialFare(
        {
          distanceMeters: 1_000.5,
          durationSeconds: 60,
          requestedSurgeMultiplierBps: 10_000,
        },
        standardMotorbikeRules,
      ),
    ).toThrowError(PricingInputError);
  });
});

describe('calculateFinalFare', () => {
  it('uses observed distance and duration with the accepted surge snapshot', () => {
    expect(
      calculateFinalFare(
        {
          distanceMeters: 3_250,
          durationSeconds: 480,
          appliedSurgeMultiplierBps: 12_000,
        },
        standardMotorbikeRules,
      ),
    ).toEqual({
      currency: 'VND',
      baseFareMinor: 12_000,
      distanceFareMinor: 22_100,
      durationFareMinor: 2_800,
      subtotalMinor: 36_900,
      serviceMultiplierBps: 10_500,
      serviceAdjustedFareMinor: 38_745,
      appliedSurgeMultiplierBps: 12_000,
      totalFareMinor: 46_494,
    });
  });

  it('clamps a malformed stored surge value to the accepted rule bounds', () => {
    expect(
      calculateFinalFare(
        {
          distanceMeters: 1_000,
          durationSeconds: 60,
          appliedSurgeMultiplierBps: 50_000,
        },
        standardMotorbikeRules,
      ).appliedSurgeMultiplierBps,
    ).toBe(15_000);
  });

  it('rejects non-integer observed metering', () => {
    expect(() =>
      calculateFinalFare(
        {
          distanceMeters: 1_000.5,
          durationSeconds: 60,
          appliedSurgeMultiplierBps: 10_000,
        },
        standardMotorbikeRules,
      ),
    ).toThrowError(PricingInputError);
  });
});
