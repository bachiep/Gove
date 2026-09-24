import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type {
  CancelTripResponse,
  ActiveTripResponse,
  CancellationReasonCode,
  PaymentStatus,
  ServiceType,
  TripCancellationRuleCode,
  TripHistoryItem,
  TripResponse,
  TripState,
} from '@gove/contracts';
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
  applied_surge_multiplier_bps: number;
  total_fare_minor: string;
  currency: string;
  status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'INVALIDATED';
  expires_at: Date;
}

interface TripRow extends QueryResultRow {
  id: string;
  created_at: Date;
}

interface HistoryRow extends QueryResultRow {
  id: string;
  fare_quote_id: string;
  service_type_code: ServiceType;
  state: TripHistoryItem['state'];
  version: number;
  currency: string;
  quoted_total_fare_minor: string;
  actual_distance_meters: number | null;
  actual_duration_seconds: number | null;
  final_fare_minor: string | null;
  created_at: Date;
  completed_at: Date | null;
  driver_id: string | null;
  payment_status: PaymentStatus | null;
}

interface CancellableTripRow extends QueryResultRow {
  id: string;
  fare_quote_id: string;
  service_type_code: ServiceType;
  state: TripState;
  version: number;
  currency: string;
  quoted_total_fare_minor: string;
  created_at: Date;
  actual_distance_meters: number | null;
  actual_duration_seconds: number | null;
  final_fare_minor: string | null;
  completed_at: Date | null;
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
        `${input.customerUserId}:create-trip`,
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
                rule_snapshot, applied_surge_multiplier_bps, total_fare_minor,
                currency, status, expires_at
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

      const activeTrip = await executor.query<{ id: string }>(
        `SELECT id
         FROM trip.trips
         WHERE customer_user_id = $1
           AND state IN ('REQUESTED', 'MATCHING', 'DRIVER_TO_PICKUP', 'AT_PICKUP', 'IN_PROGRESS')
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [input.customerUserId],
      );
      if (activeTrip.rowCount === 1)
        throw new TripCommandError('ACTIVE_TRIP_EXISTS');

      const tripId = randomUUID();
      const trip = await executor.query<TripRow>(
        `INSERT INTO trip.trips (
          id, customer_user_id, fare_quote_id, service_type_code,
          pickup_label, pickup_location, dropoff_label, dropoff_location,
          quote_snapshot, applied_surge_multiplier_bps, quoted_total_fare_minor,
          currency
        ) VALUES (
          $1, $2, $3, $4,
          $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
          $8, ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography,
          $11, $12, $13, $14
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
          quote.applied_surge_multiplier_bps,
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

  async listHistory(
    actorId: string,
    role: 'CUSTOMER' | 'DRIVER',
  ): Promise<TripHistoryItem[]> {
    const result = await this.database.query<HistoryRow>(
      `SELECT t.id, t.fare_quote_id, t.service_type_code, t.state, t.version,
              t.currency, t.quoted_total_fare_minor,
              t.actual_distance_meters, t.actual_duration_seconds,
              t.final_fare_minor, t.created_at, t.completed_at,
              a.driver_user_id AS driver_id,
              latest_payment.status AS payment_status
       FROM trip.trips t
       LEFT JOIN dispatch.assignments a ON a.trip_id = t.id
       LEFT JOIN LATERAL (
         SELECT p.status
         FROM payment.payment_attempts p
         WHERE p.trip_id = t.id
         ORDER BY p.attempt_number DESC
         LIMIT 1
       ) latest_payment ON true
       WHERE t.state IN ('COMPLETED', 'CANCELLED', 'NO_DRIVER_AVAILABLE')
         AND (
           ($2 = 'CUSTOMER' AND t.customer_user_id = $1)
           OR ($2 = 'DRIVER' AND a.driver_user_id = $1)
         )
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [actorId, role],
    );
    return result.rows.map((row) => ({
      id: row.id,
      fareQuoteId: row.fare_quote_id,
      serviceType: row.service_type_code,
      state: row.state,
      version: row.version,
      currency: row.currency,
      quotedTotalFareMinor: safeInteger(
        row.quoted_total_fare_minor,
        'quoted_total_fare_minor',
      ),
      createdAt: row.created_at.toISOString(),
      driverId: row.driver_id,
      actualDistanceMeters: row.actual_distance_meters,
      actualDurationSeconds: row.actual_duration_seconds,
      finalFareMinor:
        row.final_fare_minor === null
          ? null
          : safeInteger(row.final_fare_minor, 'final_fare_minor'),
      completedAt: row.completed_at?.toISOString() ?? null,
      paymentStatus: row.payment_status,
    }));
  }

  async findCurrentForCustomer(
    customerUserId: string,
  ): Promise<ActiveTripResponse | null> {
    const result = await this.database.query<
      HistoryRow & {
        pickup_label: string;
        pickup_latitude: string;
        pickup_longitude: string;
        dropoff_label: string;
        dropoff_latitude: string;
        dropoff_longitude: string;
      }
    >(
      `SELECT t.id, t.fare_quote_id, t.service_type_code, t.state, t.version,
              t.currency, t.quoted_total_fare_minor,
              t.actual_distance_meters, t.actual_duration_seconds,
              t.final_fare_minor, t.created_at, t.completed_at,
              a.driver_user_id AS driver_id,
              latest_payment.status AS payment_status,
              t.pickup_label,
              ST_Y(t.pickup_location::geometry) AS pickup_latitude,
              ST_X(t.pickup_location::geometry) AS pickup_longitude,
              t.dropoff_label,
              ST_Y(t.dropoff_location::geometry) AS dropoff_latitude,
              ST_X(t.dropoff_location::geometry) AS dropoff_longitude
       FROM trip.trips t
       LEFT JOIN dispatch.assignments a
         ON a.trip_id = t.id AND a.status = 'ACTIVE'
       LEFT JOIN LATERAL (
         SELECT p.status
         FROM payment.payment_attempts p
         WHERE p.trip_id = t.id
         ORDER BY p.attempt_number DESC
         LIMIT 1
       ) latest_payment ON true
       WHERE t.customer_user_id = $1
         AND t.state IN ('REQUESTED', 'MATCHING', 'DRIVER_TO_PICKUP', 'AT_PICKUP', 'IN_PROGRESS')
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 1`,
      [customerUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      fareQuoteId: row.fare_quote_id,
      serviceType: row.service_type_code,
      state: row.state,
      version: row.version,
      currency: row.currency,
      quotedTotalFareMinor: safeInteger(
        row.quoted_total_fare_minor,
        'quoted_total_fare_minor',
      ),
      createdAt: row.created_at.toISOString(),
      driverId: row.driver_id,
      actualDistanceMeters: row.actual_distance_meters,
      actualDurationSeconds: row.actual_duration_seconds,
      finalFareMinor:
        row.final_fare_minor === null
          ? null
          : safeInteger(row.final_fare_minor, 'final_fare_minor'),
      completedAt: row.completed_at?.toISOString() ?? null,
      pickup: {
        label: row.pickup_label,
        latitude: finiteNumber(row.pickup_latitude, 'pickup_latitude'),
        longitude: finiteNumber(row.pickup_longitude, 'pickup_longitude'),
      },
      dropoff: {
        label: row.dropoff_label,
        latitude: finiteNumber(row.dropoff_latitude, 'dropoff_latitude'),
        longitude: finiteNumber(row.dropoff_longitude, 'dropoff_longitude'),
      },
    };
  }

  async cancelTrip(input: {
    customerUserId: string;
    tripId: string;
    idempotencyKey: string;
    correlationId: string;
    reasonCode: CancellationReasonCode;
    reasonDetail?: string;
    requestFingerprint: Buffer;
  }): Promise<CancelTripResponse> {
    return this.database.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.customerUserId}:cancel-trip:${input.idempotencyKey}`,
      ]);
      const receiptResult = await executor.query<{
        request_fingerprint: Buffer;
        response_body: CancelTripResponse;
      }>(
        `SELECT request_fingerprint, response_body
         FROM trip.command_receipts
         WHERE actor_user_id = $1 AND operation = 'CANCEL_TRIP' AND idempotency_key = $2
         FOR UPDATE`,
        [input.customerUserId, input.idempotencyKey],
      );
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (
          !sameDigest(receipt.request_fingerprint, input.requestFingerprint)
        ) {
          throw new TripCommandError('IDEMPOTENCY_KEY_REUSED');
        }
        return receipt.response_body;
      }

      const tripResult = await executor.query<CancellableTripRow>(
        `SELECT id, fare_quote_id, service_type_code, state, version, currency,
                quoted_total_fare_minor, created_at, actual_distance_meters,
                actual_duration_seconds, final_fare_minor, completed_at
         FROM trip.trips
         WHERE id = $1 AND customer_user_id = $2
         FOR UPDATE`,
        [input.tripId, input.customerUserId],
      );
      const trip = tripResult.rows[0];
      if (!trip) throw new TripCommandError('TRIP_NOT_FOUND');

      const ruleCode = customerCancellationRule(trip.state);
      if (!ruleCode)
        throw new TripCommandError('TRIP_CANCELLATION_NOT_ALLOWED');

      let driverId: string | null = null;
      const cancelledDriverUserIds = new Set<string>();
      if (trip.state === 'MATCHING') {
        const offerResult = await executor.query<{
          id: string;
          driver_user_id: string;
        }>(
          `SELECT id, driver_user_id
           FROM dispatch.trip_offers
           WHERE trip_id = $1 AND status = 'PENDING'
           FOR UPDATE`,
          [trip.id],
        );
        for (const offer of offerResult.rows) {
          cancelledDriverUserIds.add(offer.driver_user_id);
          await executor.query(
            `UPDATE dispatch.trip_offers
             SET status = 'REVOKED', resolved_at = now(),
                 resolution_reason = 'CUSTOMER_CANCELLED', resolved_by_user_id = $2
             WHERE id = $1 AND status = 'PENDING'`,
            [offer.id, input.customerUserId],
          );
          await executor.query(
            `UPDATE dispatch.driver_reservations
             SET status = 'RELEASED', resolved_at = now(),
                 resolution_reason = 'CUSTOMER_CANCELLED', resolved_by_user_id = $2
             WHERE id = (
               SELECT reservation_id
               FROM dispatch.trip_offers
               WHERE id = $1
             ) AND status = 'ACTIVE'`,
            [offer.id, input.customerUserId],
          );
          const workState = await executor.query(
            `UPDATE dispatch.driver_work_states
             SET work_state = 'AVAILABLE', current_trip_id = NULL,
                 state_version = state_version + 1,
                 state_changed_at = now(), updated_at = now()
             WHERE driver_user_id = $1 AND work_state = 'RESERVED'
               AND current_trip_id = $2`,
            [offer.driver_user_id, trip.id],
          );
          if (workState.rowCount !== 1) {
            throw new TripCommandError('TRIP_CANCELLATION_NOT_ALLOWED');
          }
        }
      }
      if (trip.state === 'DRIVER_TO_PICKUP' || trip.state === 'AT_PICKUP') {
        const assignmentResult = await executor.query<{
          id: string;
          driver_user_id: string;
        }>(
          `SELECT id, driver_user_id
           FROM dispatch.assignments
           WHERE trip_id = $1 AND status = 'ACTIVE'
           FOR UPDATE`,
          [trip.id],
        );
        const assignment = assignmentResult.rows[0];
        if (!assignment)
          throw new TripCommandError('TRIP_CANCELLATION_NOT_ALLOWED');
        driverId = assignment.driver_user_id;
        cancelledDriverUserIds.add(assignment.driver_user_id);
        await executor.query(
          `UPDATE dispatch.assignments
           SET status = 'CANCELLED', released_at = now(),
               release_reason = 'CUSTOMER_CANCELLED'
           WHERE id = $1 AND status = 'ACTIVE'`,
          [assignment.id],
        );
        const workState = await executor.query(
          `UPDATE dispatch.driver_work_states
           SET work_state = 'AVAILABLE', current_trip_id = NULL,
               state_version = state_version + 1,
               state_changed_at = now(), updated_at = now()
           WHERE driver_user_id = $1 AND work_state = 'TO_PICKUP'
             AND current_trip_id = $2`,
          [assignment.driver_user_id, trip.id],
        );
        if (workState.rowCount !== 1) {
          throw new TripCommandError('TRIP_CANCELLATION_NOT_ALLOWED');
        }
      }

      const nextVersion = trip.version + 1;
      const update = await executor.query(
        `UPDATE trip.trips
         SET state = 'CANCELLED', version = $2, updated_at = now()
         WHERE id = $1 AND state = $3 AND version = $4`,
        [trip.id, nextVersion, trip.state, trip.version],
      );
      if (update.rowCount !== 1) {
        throw new TripCommandError('TRIP_CANCELLATION_NOT_ALLOWED');
      }
      const cancellation = await executor.query<{ cancelled_at: Date }>(
        `INSERT INTO trip.cancellations (
           id, trip_id, actor_user_id, actor_role, reason_code, reason_detail,
           rule_code, correlation_id
         ) VALUES ($1, $2, $3, 'CUSTOMER', $4, $5, $6, $7)
         RETURNING cancelled_at`,
        [
          randomUUID(),
          trip.id,
          input.customerUserId,
          input.reasonCode,
          input.reasonDetail ?? null,
          ruleCode,
          input.correlationId,
        ],
      );
      const cancelledAt = cancellation.rows[0]?.cancelled_at;
      if (!cancelledAt)
        throw new Error('Cancellation timestamp was not returned');
      await executor.query(
        `INSERT INTO trip.state_transitions (
           id, trip_id, actor_user_id, command, from_state, to_state,
           from_version, to_version, reason, correlation_id
         ) VALUES ($1, $2, $3, 'CANCEL_TRIP', $4, 'CANCELLED', $5, $6, $7, $8)`,
        [
          randomUUID(),
          trip.id,
          input.customerUserId,
          trip.state,
          trip.version,
          nextVersion,
          input.reasonCode,
          input.correlationId,
        ],
      );
      await executor.query(
        `INSERT INTO trip.outbox_events (
           id, trip_id, aggregate_version, event_type, payload
         ) VALUES ($1, $2, $3, 'trip.cancelled', $4)`,
        [
          randomUUID(),
          trip.id,
          nextVersion,
          JSON.stringify({
            tripId: trip.id,
            state: 'CANCELLED',
            version: nextVersion,
            cancelledByRole: 'CUSTOMER',
            reasonCode: input.reasonCode,
            ruleCode,
            cancelledAt: cancelledAt.toISOString(),
            driverUserIds: [...cancelledDriverUserIds],
          }),
        ],
      );
      const response: CancelTripResponse = {
        id: trip.id,
        fareQuoteId: trip.fare_quote_id,
        serviceType: trip.service_type_code,
        state: 'CANCELLED',
        version: nextVersion,
        currency: trip.currency,
        quotedTotalFareMinor: safeInteger(
          trip.quoted_total_fare_minor,
          'quoted_total_fare_minor',
        ),
        createdAt: trip.created_at.toISOString(),
        driverId,
        actualDistanceMeters: trip.actual_distance_meters,
        actualDurationSeconds: trip.actual_duration_seconds,
        finalFareMinor:
          trip.final_fare_minor === null
            ? null
            : safeInteger(trip.final_fare_minor, 'final_fare_minor'),
        completedAt: trip.completed_at?.toISOString() ?? null,
        cancellation: {
          cancelledByRole: 'CUSTOMER',
          reasonCode: input.reasonCode,
          ruleCode,
          cancelledAt: cancelledAt.toISOString(),
        },
      };
      await executor.query(
        `INSERT INTO trip.command_receipts (
           actor_user_id, operation, idempotency_key, request_fingerprint, response_body, trip_id
         ) VALUES ($1, 'CANCEL_TRIP', $2, $3, $4, $5)`,
        [
          input.customerUserId,
          input.idempotencyKey,
          input.requestFingerprint,
          JSON.stringify(response),
          trip.id,
        ],
      );
      return response;
    });
  }
}

export class TripCommandError extends Error {
  constructor(
    readonly code:
      | 'FARE_QUOTE_NOT_FOUND'
      | 'FARE_QUOTE_EXPIRED'
      | 'FARE_QUOTE_ALREADY_CONSUMED'
      | 'ACTIVE_TRIP_EXISTS'
      | 'TRIP_NOT_FOUND'
      | 'TRIP_CANCELLATION_NOT_ALLOWED'
      | 'IDEMPOTENCY_KEY_REUSED',
  ) {
    super(code);
  }
}

function customerCancellationRule(
  state: TripState,
): TripCancellationRuleCode | null {
  switch (state) {
    case 'REQUESTED':
    case 'MATCHING':
    case 'DRIVER_TO_PICKUP':
      return 'CUSTOMER_PRE_TRIP';
    case 'AT_PICKUP':
      return 'CUSTOMER_AT_PICKUP';
    default:
      return null;
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
