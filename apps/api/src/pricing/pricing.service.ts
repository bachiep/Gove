import { createHash } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  FareQuoteResponse,
  RideLocation,
  ServiceType,
} from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import {
  PricingCommandError,
  PricingRepository,
} from './pricing.repository.js';

const serviceArea = {
  minimumLatitude: 10.74,
  maximumLatitude: 10.82,
  minimumLongitude: 106.64,
  maximumLongitude: 106.74,
} as const;
const quoteTtlMilliseconds = 5 * 60_000;
const estimatedMetersPerSecond = 5;

@Injectable()
export class PricingService {
  constructor(
    @Inject(PricingRepository) private readonly repository: PricingRepository,
  ) {}

  async createFareQuote(input: {
    customerUserId: string;
    idempotencyKey: string;
    pickup: RideLocation;
    dropoff: RideLocation;
    serviceType: ServiceType;
  }): Promise<FareQuoteResponse> {
    validateServiceArea(input.pickup, 'pickup');
    validateServiceArea(input.dropoff, 'dropoff');
    const distanceMeters = haversineMeters(input.pickup, input.dropoff);
    if (distanceMeters < 1) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'RIDE_POINTS_IDENTICAL',
        'Pickup and dropoff must differ.',
      );
    }
    const durationSeconds = Math.max(
      60,
      Math.ceil(distanceMeters / estimatedMetersPerSecond),
    );

    try {
      return await this.repository.createFareQuote({
        ...input,
        distanceMeters,
        durationSeconds,
        requestedSurgeMultiplierBps: 10_000,
        expiresAt: new Date(Date.now() + quoteTtlMilliseconds),
        requestFingerprint: fingerprint({
          pickup: input.pickup,
          dropoff: input.dropoff,
          serviceType: input.serviceType,
        }),
      });
    } catch (error) {
      if (error instanceof PricingCommandError) {
        throw new ApiError(
          error.code === 'SERVICE_TYPE_UNAVAILABLE'
            ? HttpStatus.UNPROCESSABLE_ENTITY
            : HttpStatus.CONFLICT,
          error.code,
          error.code === 'SERVICE_TYPE_UNAVAILABLE'
            ? 'The selected service is not available.'
            : 'The idempotency key was reused with a different request.',
        );
      }
      throw error;
    }
  }
}

function validateServiceArea(location: RideLocation, field: string): void {
  if (
    location.latitude < serviceArea.minimumLatitude ||
    location.latitude > serviceArea.maximumLatitude ||
    location.longitude < serviceArea.minimumLongitude ||
    location.longitude > serviceArea.maximumLongitude
  ) {
    throw new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'OUTSIDE_SERVICE_AREA',
      'The location is outside the current demo service area.',
      [{ field, reason: 'outside_service_area' }],
    );
  }
}

function haversineMeters(pickup: RideLocation, dropoff: RideLocation): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (dropoff.latitude - pickup.latitude) * radians;
  const longitudeDelta = (dropoff.longitude - pickup.longitude) * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(pickup.latitude * radians) *
      Math.cos(dropoff.latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return Math.max(
    1,
    Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))),
  );
}

function fingerprint(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}
