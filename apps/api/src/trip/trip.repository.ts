import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { ServiceType, TripResponse } from '@gove/contracts';
import type { QueryResultRow } from 'pg';

import { DatabaseService } from '../database/database.service.js';

interface QuoteRow extends QueryResultRow {
  id: string;
  customer_user_id: string;
  service_type_code: ServiceType;
  pickup_label: string;
  pickup_longitude: string;
  pickup_latitude: string;
  dropoff_label: string;
  dropoff_longitude: string;
  dropoff_latitude: string;
  rule_snapshot: unknown;
  total_fare_minor: string;
  currency: string;
  status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'INVALIDATED';
  expires_at: Date;
}

interface TripRow extends QueryResultRow {
  id: string;
  created_at: Date;
}

export interface CreateTripRecord {
  customerUserId: string;
  fareQuoteId: string;
  idempotencyKey: string;
  requestFingerprint: Buffer;
  correlationId: string;
}

@Injectable()
export class TripRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async createTrip(input: CreateTripRecord): Promise<TripResponse> {
    return this.database.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.customerUserId}:create-trip:${input.idempotencyKey}`,
      ]);
      const receipt = await executor.query<{
        request_fingerprint: Buffer;
        response_body: TripResponse;
      }>(
        `SELECT request_fingerprint, response_body
         FROM trip.command_receipts
         WHERE actor_user_id = $1 AND operation = 'CREATE_TRIP' AND idempotency_key = $2
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
          throw new TripCommandError('IDEMPOTENCY_KEY_REUSED');
        }
        return existingReceipt.response_body;
      }

      const quoteResult = await executor.query<QuoteRow>(
        `SELECT id, customer_user_id, service_type_code, pickup_label,
                ST_X(pickup_location::geometry) AS pickup_longitude,
                ST_Y(pickup_location::geometry) AS pickup_latitude,
                dropoff_label,
                ST_X(dropoff_location::geometry) AS dropoff_longitude,
                ST_Y(dropoff_location::geometry) AS dropoff_latitude,
                rule_snapshot, total_fare_minor, currency, status, expires_at
         FROM pricing.fare_quotes
         WHERE id = $1
         FOR UPDATE`,
        [input.fareQuoteId],
      );
      const quote = quoteResult.rows[0];
      if (!quote || quote.customer_user_id !== input.customerUserId) {
        throw new TripCommandError('FARE_QUOTE_NOT_FOUND');
      }
      if (
        quote.status === 'ACTIVE' &&
        quote.expires_at.getTime() <= Date.now()
      ) {
        await executor.query(
          "UPDATE pricing.fare_quotes SET status = 'EXPIRED' WHERE id = $1",
          [quote.id],
        );
        throw new TripCommandError('FARE_QUOTE_EXPIRED');
      }
      if (quote.status === 'EXPIRED')
        throw new TripCommandError('FARE_QUOTE_EXPIRED');
      if (quote.status !== 'ACTIVE')
        throw new TripCommandError('FARE_QUOTE_ALREADY_CONSUMED');

      const tripId = randomUUID();
      const trip = await executor.query<TripRow>(
        `INSERT INTO trip.trips (
          id, customer_user_id, fare_quote_id, service_type_code,
          pickup_label, pickup_location, dropoff_label, dropoff_location,
          quote_snapshot, quoted_total_fare_minor, currency
        ) VALUES (
          $1, $2, $3, $4,
          $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
          $8, ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography,
          $11, $12, $13
        ) RETURNING id, created_at`,
        [
          tripId,
          input.customerUserId,
          quote.id,
          quote.service_type_code,
          quote.pickup_label,
          finiteNumber(quote.pickup_longitude, 'pickup_longitude'),
          finiteNumber(quote.pickup_latitude, 'pickup_latitude'),
          quote.dropoff_label,
          finiteNumber(quote.dropoff_longitude, 'dropoff_longitude'),
          finiteNumber(quote.dropoff_latitude, 'dropoff_latitude'),
          JSON.stringify(quote.rule_snapshot),
          safeInteger(quote.total_fare_minor, 'total_fare_minor'),
          quote.currency,
        ],
      );
      await executor.query(
        `UPDATE pricing.fare_quotes
         SET status = 'CONSUMED', consumed_at = now()
         WHERE id = $1`,
        [quote.id],
      );
      await executor.query(
        `INSERT INTO trip.state_transitions (
          id, trip_id, actor_user_id, command, to_state, to_version, correlation_id
        ) VALUES ($1, $2, $3, 'CREATE_TRIP', 'REQUESTED', 0, $4)`,
        [randomUUID(), tripId, input.customerUserId, input.correlationId],
      );
      const result: TripResponse = {
        id: tripId,
        fareQuoteId: quote.id,
        serviceType: quote.service_type_code,
        state: 'REQUESTED',
        version: 0,
        currency: quote.currency,
        quotedTotalFareMinor: safeInteger(
          quote.total_fare_minor,
          'total_fare_minor',
        ),
        createdAt: (trip.rows[0] as TripRow).created_at.toISOString(),
      };
      await executor.query(
        `INSERT INTO trip.outbox_events (
          id, trip_id, aggregate_version, event_type, payload
        ) VALUES ($1, $2, 0, 'trip.created', $3)`,
        [
          randomUUID(),
          tripId,
          JSON.stringify({
            tripId,
            customerUserId: input.customerUserId,
            fareQuoteId: quote.id,
            state: 'REQUESTED',
            version: 0,
          }),
        ],
      );
      await executor.query(
        `INSERT INTO trip.command_receipts (
          actor_user_id, operation, idempotency_key, request_fingerprint, response_body, trip_id
        ) VALUES ($1, 'CREATE_TRIP', $2, $3, $4, $5)`,
        [
          input.customerUserId,
          input.idempotencyKey,
          input.requestFingerprint,
          JSON.stringify(result),
          tripId,
        ],
      );
      return result;
    });
  }
}

export class TripCommandError extends Error {
  constructor(
    readonly code:
      | 'FARE_QUOTE_NOT_FOUND'
      | 'FARE_QUOTE_EXPIRED'
      | 'FARE_QUOTE_ALREADY_CONSUMED'
      | 'IDEMPOTENCY_KEY_REUSED',
  ) {
    super(code);
  }
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

function finiteNumber(value: string, column: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${column} is not finite`);
  return parsed;
}

function safeInteger(value: string, column: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${column} is not a non-negative safe integer`);
  }
  return parsed;
}
