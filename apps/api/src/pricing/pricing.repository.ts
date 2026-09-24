import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type {
  FareQuoteRoute,
  FareQuoteResponse,
  RideLocation,
  ServiceType,
} from '@gove/contracts';
import type { QueryResultRow } from 'pg';

import { DatabaseService } from '../database/database.service.js';
import {
  quoteInitialFare,
  type FarePricingRuleSnapshot,
} from './fare-quote.js';

interface RateCardRow extends QueryResultRow {
  id: string;
  version: number;
  currency: string;
  base_fare_minor: string;
  distance_rate_minor_per_kilometer: string;
  duration_rate_minor_per_minute: string;
  service_multiplier_bps: number;
  minimum_surge_multiplier_bps: number;
  maximum_surge_multiplier_bps: number;
}

interface FareQuoteRow extends QueryResultRow {
  id: string;
  expires_at: Date;
}

export interface CreateFareQuoteRecord {
  customerUserId: string;
  idempotencyKey: string;
  requestFingerprint: Buffer;
  serviceType: ServiceType;
  pickup: RideLocation;
  dropoff: RideLocation;
  distanceMeters: number;
  durationSeconds: number;
  route: FareQuoteRoute;
  requestedSurgeMultiplierBps: number;
  expiresAt: Date;
}

export interface FareQuoteReceiptLookup {
  customerUserId: string;
  idempotencyKey: string;
  requestFingerprint: Buffer;
}

@Injectable()
export class PricingRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async findFareQuoteReceipt(
    input: FareQuoteReceiptLookup,
  ): Promise<FareQuoteResponse | null> {
    const result = await this.database.query<{
      request_fingerprint: Buffer;
      response_body: FareQuoteResponse;
    }>(
      `SELECT request_fingerprint, response_body
       FROM pricing.command_receipts
       WHERE actor_user_id = $1 AND operation = 'CREATE_FARE_QUOTE' AND idempotency_key = $2`,
      [input.customerUserId, input.idempotencyKey],
    );
    const receipt = result.rows[0];
    if (!receipt) return null;
    if (!sameDigest(receipt.request_fingerprint, input.requestFingerprint)) {
      throw new PricingCommandError('IDEMPOTENCY_KEY_REUSED');
    }
    return receipt.response_body;
  }

  async createFareQuote(
    input: CreateFareQuoteRecord,
  ): Promise<FareQuoteResponse> {
    return this.database.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.customerUserId}:create-fare-quote:${input.idempotencyKey}`,
      ]);
      const receipt = await executor.query<{
        request_fingerprint: Buffer;
        response_body: FareQuoteResponse;
      }>(
        `SELECT request_fingerprint, response_body
         FROM pricing.command_receipts
         WHERE actor_user_id = $1 AND operation = 'CREATE_FARE_QUOTE' AND idempotency_key = $2
         FOR UPDATE`,
        [input.customerUserId, input.idempotencyKey],
      );
      const existingReceipt = receipt.rows[0];
      if (existingReceipt) {
        if (
          !sameDigest(
            existingReceipt.request_fingerprint,
            input.requestFingerprint,
          )
        ) {
          throw new PricingCommandError('IDEMPOTENCY_KEY_REUSED');
        }
        return existingReceipt.response_body;
      }

      const rateCard = await executor.query<RateCardRow>(
        `SELECT r.id, r.version, r.currency, r.base_fare_minor,
                r.distance_rate_minor_per_kilometer, r.duration_rate_minor_per_minute,
                r.service_multiplier_bps, r.minimum_surge_multiplier_bps,
                r.maximum_surge_multiplier_bps
         FROM pricing.rate_card_versions r
         JOIN pricing.service_types s ON s.code = r.service_type_code
         WHERE r.service_type_code = $1 AND s.is_active
         ORDER BY r.effective_from DESC
         LIMIT 1`,
        [input.serviceType],
      );
      const card = rateCard.rows[0];
      if (!card) throw new PricingCommandError('SERVICE_TYPE_UNAVAILABLE');

      const fare = quoteInitialFare(
        {
          distanceMeters: input.distanceMeters,
          durationSeconds: input.durationSeconds,
          requestedSurgeMultiplierBps: input.requestedSurgeMultiplierBps,
        },
        toRuleSnapshot(input.serviceType, card),
      );
      const quoteId = randomUUID();
      const created = await executor.query<FareQuoteRow>(
        `INSERT INTO pricing.fare_quotes (
          id, customer_user_id, service_type_code, rate_card_version_id,
          pickup_label, pickup_location, dropoff_label, dropoff_location,
          estimated_distance_meters, estimated_duration_seconds, currency,
          base_fare_minor, distance_fare_minor, duration_fare_minor,
          service_multiplier_bps, service_adjusted_fare_minor,
          applied_surge_multiplier_bps, total_fare_minor, rule_snapshot, expires_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
          $8, ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
        ) RETURNING id, expires_at`,
        [
          quoteId,
          input.customerUserId,
          input.serviceType,
          card.id,
          input.pickup.label,
          input.pickup.longitude,
          input.pickup.latitude,
          input.dropoff.label,
          input.dropoff.longitude,
          input.dropoff.latitude,
          input.distanceMeters,
          input.durationSeconds,
          fare.currency,
          fare.baseFareMinor,
          fare.distanceFareMinor,
          fare.durationFareMinor,
          fare.serviceMultiplierBps,
          fare.serviceAdjustedFareMinor,
          fare.appliedSurgeMultiplierBps,
          fare.totalFareMinor,
          JSON.stringify(fare.ruleSnapshot),
          input.expiresAt,
        ],
      );
      const result: FareQuoteResponse = {
        id: quoteId,
        serviceType: input.serviceType,
        pickup: input.pickup,
        dropoff: input.dropoff,
        estimatedDistanceMeters: input.distanceMeters,
        estimatedDurationSeconds: input.durationSeconds,
        currency: fare.currency,
        totalFareMinor: fare.totalFareMinor,
        expiresAt: (created.rows[0] as FareQuoteRow).expires_at.toISOString(),
        route: input.route,
      };
      await executor.query(
        `INSERT INTO pricing.command_receipts
          (actor_user_id, operation, idempotency_key, request_fingerprint, response_body)
         VALUES ($1, 'CREATE_FARE_QUOTE', $2, $3, $4)`,
        [
          input.customerUserId,
          input.idempotencyKey,
          input.requestFingerprint,
          JSON.stringify(result),
        ],
      );
      return result;
    });
  }
}

export class PricingCommandError extends Error {
  constructor(
    readonly code: 'IDEMPOTENCY_KEY_REUSED' | 'SERVICE_TYPE_UNAVAILABLE',
  ) {
    super(code);
  }
}

function toRuleSnapshot(
  serviceType: ServiceType,
  card: RateCardRow,
): FarePricingRuleSnapshot {
  return {
    version: `${serviceType}:${card.version}`,
    currency: card.currency,
    serviceType,
    baseFareMinor: safeInteger(card.base_fare_minor, 'base_fare_minor'),
    distanceRateMinorPerKilometer: safeInteger(
      card.distance_rate_minor_per_kilometer,
      'distance_rate_minor_per_kilometer',
    ),
    durationRateMinorPerMinute: safeInteger(
      card.duration_rate_minor_per_minute,
      'duration_rate_minor_per_minute',
    ),
    serviceMultiplierBps: card.service_multiplier_bps,
    minimumSurgeMultiplierBps: card.minimum_surge_multiplier_bps,
    maximumSurgeMultiplierBps: card.maximum_surge_multiplier_bps,
  };
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

function safeInteger(value: string, column: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${column} is not a non-negative safe integer`);
  }
  return parsed;
}
