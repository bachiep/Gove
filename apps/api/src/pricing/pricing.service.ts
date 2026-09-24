import { createHash } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  FareQuoteResponse,
  FareQuoteRoute,
  RideLocation,
  ServiceType,
} from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import { RoutingError, RoutingService } from '../routing/index.js';
import {
  PricingCommandError,
  PricingRepository,
} from './pricing.repository.js';

const serviceArea = {
  minimumLatitude: 20.98,
  maximumLatitude: 21.1,
  minimumLongitude: 105.76,
  maximumLongitude: 105.9,
} as const;
const quoteTtlMilliseconds = 5 * 60_000;
const minimumQuoteDistanceMeters = 1;
const minimumQuoteDurationSeconds = 60;

interface InFlightFareQuote {
  requestFingerprint: Buffer;
  promise: Promise<FareQuoteResponse>;
}

@Injectable()
export class PricingService {
  private readonly inFlightFareQuotes = new Map<string, InFlightFareQuote>();

  constructor(
    @Inject(PricingRepository) private readonly repository: PricingRepository,
    @Inject(RoutingService) private readonly routing: RoutingService,
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
    const requestFingerprint = fingerprint({
      pickup: input.pickup,
      dropoff: input.dropoff,
      serviceType: input.serviceType,
    });
    const inFlightKey = `${input.customerUserId}:${input.idempotencyKey}`;
    const inFlight = this.inFlightFareQuotes.get(inFlightKey);
    if (inFlight) {
      if (!sameDigest(inFlight.requestFingerprint, requestFingerprint)) {
        throw idempotencyKeyReuseError();
      }
      return inFlight.promise;
    }

    const promise = this.createFareQuoteOnce(input, requestFingerprint);
    this.inFlightFareQuotes.set(inFlightKey, { requestFingerprint, promise });
    try {
      return await promise;
    } finally {
      if (this.inFlightFareQuotes.get(inFlightKey)?.promise === promise) {
        this.inFlightFareQuotes.delete(inFlightKey);
      }
    }
  }

  private async createFareQuoteOnce(
    input: {
      customerUserId: string;
      idempotencyKey: string;
      pickup: RideLocation;
      dropoff: RideLocation;
      serviceType: ServiceType;
    },
    requestFingerprint: Buffer,
  ): Promise<FareQuoteResponse> {
    try {
      const existing = await this.repository.findFareQuoteReceipt({
        customerUserId: input.customerUserId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
      });
      if (existing) return existing;

      if (
        input.pickup.latitude === input.dropoff.latitude &&
        input.pickup.longitude === input.dropoff.longitude
      ) {
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          'RIDE_POINTS_IDENTICAL',
          'Pickup and dropoff must differ.',
        );
      }

      const route = await this.routeFareEstimate(input.pickup, input.dropoff);
      const distanceMeters = Math.max(
        minimumQuoteDistanceMeters,
        Math.round(route.distanceMeters),
      );
      const durationSeconds = Math.max(
        minimumQuoteDurationSeconds,
        route.durationSeconds,
      );

      return await this.repository.createFareQuote({
        ...input,
        distanceMeters,
        durationSeconds,
        route: toFareQuoteRoute(route),
        requestedSurgeMultiplierBps: 10_000,
        expiresAt: new Date(Date.now() + quoteTtlMilliseconds),
        requestFingerprint,
      });
    } catch (error) {
      if (error instanceof PricingCommandError) {
        throw mapPricingCommandError(error);
      }
      throw error;
    }
  }

  private async routeFareEstimate(pickup: RideLocation, dropoff: RideLocation) {
    try {
      const route = await this.routing.route({
        origin: {
          latitude: pickup.latitude,
          longitude: pickup.longitude,
        },
        destination: {
          latitude: dropoff.latitude,
          longitude: dropoff.longitude,
        },
        profile: 'DRIVING',
      });

      return route;
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (error instanceof RoutingError) {
        throw new ApiError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ROUTING_UNAVAILABLE',
          'A route estimate is temporarily unavailable.',
        );
      }

      throw error;
    }
  }
}

function toFareQuoteRoute(
  route: Awaited<ReturnType<RoutingService['route']>>,
): FareQuoteRoute {
  return {
    geometry: route.geometry,
    provider: route.metadata.provider,
    version: route.metadata.version,
    updatedAt: route.metadata.updatedAt,
    usedFallback: route.usedFallback,
    fallbackReason: route.fallbackReason,
  };
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

function fingerprint(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

function idempotencyKeyReuseError(): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    'IDEMPOTENCY_KEY_REUSED',
    'The idempotency key was reused with a different request.',
  );
}

function mapPricingCommandError(error: PricingCommandError): ApiError {
  return new ApiError(
    error.code === 'SERVICE_TYPE_UNAVAILABLE'
      ? HttpStatus.UNPROCESSABLE_ENTITY
      : HttpStatus.CONFLICT,
    error.code,
    error.code === 'SERVICE_TYPE_UNAVAILABLE'
      ? 'The selected service is not available.'
      : 'The idempotency key was reused with a different request.',
  );
}
