import { describe, expect, it } from 'vitest';

import {
  rankEligibleDriverCandidates,
  type DriverCandidate,
} from './dispatch-ranking.js';

const candidates: DriverCandidate[] = [
  {
    driverId: 'driver-c',
    distanceMeters: 1_000,
    freshnessAgeSeconds: 4,
    eligible: true,
  },
  {
    driverId: 'driver-b',
    distanceMeters: 1_000,
    freshnessAgeSeconds: 2,
    eligible: true,
  },
  {
    driverId: 'driver-a',
    distanceMeters: 1_000,
    freshnessAgeSeconds: 2,
    eligible: true,
  },
  {
    driverId: 'driver-d',
    distanceMeters: 500,
    freshnessAgeSeconds: 9,
    eligible: true,
  },
];

describe('rankEligibleDriverCandidates', () => {
  it('orders candidates by distance, freshness age, then driver id', () => {
    expect(
      rankEligibleDriverCandidates(candidates, {
        maxFreshnessAgeSeconds: 10,
      }).map((candidate) => candidate.driverId),
    ).toEqual(['driver-d', 'driver-a', 'driver-b', 'driver-c']);
  });

  it('excludes ineligible and stale candidates at the freshness boundary', () => {
    const result = rankEligibleDriverCandidates(
      [
        ...candidates,
        {
          driverId: 'driver-ineligible',
          distanceMeters: 1,
          freshnessAgeSeconds: 0,
          eligible: false,
        },
        {
          driverId: 'driver-stale',
          distanceMeters: 2,
          freshnessAgeSeconds: 11,
          eligible: true,
        },
        {
          driverId: 'driver-boundary',
          distanceMeters: 3,
          freshnessAgeSeconds: 10,
          eligible: true,
        },
      ],
      { maxFreshnessAgeSeconds: 10 },
    );

    expect(result.map((candidate) => candidate.driverId)).toContain(
      'driver-boundary',
    );
    expect(result.map((candidate) => candidate.driverId)).not.toEqual(
      expect.arrayContaining(['driver-ineligible', 'driver-stale']),
    );
  });

  it('does not mutate the candidate input', () => {
    const input = [...candidates];

    rankEligibleDriverCandidates(input, { maxFreshnessAgeSeconds: 10 });

    expect(input).toEqual(candidates);
  });
});
