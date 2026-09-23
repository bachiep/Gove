import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type {
  DispatchMatchResponse,
  DispatchOfferRejectionResponse,
  DriverWorkState,
  TripOfferResponse,
  TripState,
} from '@gove/contracts';
import type { QueryResultRow } from 'pg';

import {
  DatabaseService,
  type DatabaseExecutor,
} from '../database/database.service.js';
import { evaluateDispatchExpiry } from './dispatch-expiry-policy.js';
import { rankEligibleDriverCandidates } from './dispatch-ranking.js';

const LOCATION_FRESHNESS_SECONDS = 15;
const OFFER_TTL_SECONDS = 10;
const MAX_OFFER_ATTEMPTS = 3;
const SEARCH_RADIUS_METERS = 5_000;
const MAX_CANDIDATES = 20;

interface TripRow extends QueryResultRow {
  id: string;
  customer_user_id: string;
  state: TripState;
  version: number;
  service_type_code: 'MOTORBIKE_STANDARD' | 'CAR_STANDARD';
}

interface CandidateRow extends QueryResultRow {
  driver_user_id: string;
  distance_meters: number;
  freshness_age_seconds: number;
}

interface WorkStateRow extends QueryResultRow {
  driver_user_id: string;
  work_state: DriverWorkState;
  state_version: string;
  updated_at: Date;
}

interface OfferRow extends QueryResultRow {
  id: string;
  trip_id: string;
  driver_user_id: string;
  attempt_number: number;
  status: TripOfferResponse['status'];
  expires_at: Date;
  trip_state: TripState;
  trip_version: number;
  accepted_by_user_id: string | null;
  acceptance_idempotency_key: string | null;
}

interface DueOfferRow extends QueryResultRow {
  id: string;
  trip_id: string;
  driver_user_id: string;
  expires_at: Date;
  database_now: Date;
  trip_state: TripState;
  trip_version: number;
  reservation_status: 'ACTIVE' | 'COMMITTED' | 'RELEASED' | 'EXPIRED' | null;
  work_state: DriverWorkState | null;
}

export type DispatchCommandErrorCode =
  | 'TRIP_NOT_FOUND'
  | 'TRIP_NOT_MATCHABLE'
  | 'DRIVER_NOT_ELIGIBLE'
  | 'DRIVER_WORK_STATE_CONFLICT'
  | 'OFFER_NOT_FOUND'
  | 'OFFER_NOT_FOR_DRIVER'
  | 'OFFER_EXPIRED'
  | 'OFFER_ALREADY_RESOLVED'
  | 'IDEMPOTENCY_KEY_REUSED';

export class DispatchCommandError extends Error {
  constructor(readonly code: DispatchCommandErrorCode) {
    super(code);
  }
}

export interface WorkStateResponse {
  driverId: string;
  state: DriverWorkState;
  stateVersion: number;
  updatedAt: string;
}

type AcceptResult =
  | { accepted: true; response: TripOfferResponse }
  | { accepted: false; code: 'OFFER_EXPIRED' | 'OFFER_ALREADY_RESOLVED' };

type RejectResult =
  | { rejected: true; response: DispatchOfferRejectionResponse }
  | {
      rejected: false;
      code: 'OFFER_EXPIRED' | 'OFFER_ALREADY_RESOLVED';
    };

@Injectable()
export class DispatchRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async setWorkState(
    driverUserId: string,
    state: 'AVAILABLE' | 'OFFLINE',
  ): Promise<WorkStateResponse> {
    return this.database.transaction(async (executor) => {
      if (state === 'AVAILABLE') {
        const eligibility = await executor.query<{ ok: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM driver.driver_profiles p
             JOIN driver.vehicles v ON v.driver_user_id = p.user_id
             WHERE p.user_id = $1
               AND p.approval_status = 'APPROVED'
               AND p.deactivated_at IS NULL
               AND v.approval_status = 'APPROVED'
               AND v.is_selected = true
           ) AS ok`,
          [driverUserId],
        );
        if (!eligibility.rows[0]?.ok) {
          throw new DispatchCommandError('DRIVER_NOT_ELIGIBLE');
        }
      }

      const current = await executor.query<WorkStateRow>(
        `SELECT driver_user_id, work_state, state_version, updated_at
         FROM dispatch.driver_work_states
         WHERE driver_user_id = $1
         FOR UPDATE`,
        [driverUserId],
      );
      const existing = current.rows[0];
      if (
        existing &&
        existing.work_state !== 'OFFLINE' &&
        existing.work_state !== 'AVAILABLE'
      ) {
        throw new DispatchCommandError('DRIVER_WORK_STATE_CONFLICT');
      }

      const result = existing
        ? await executor.query<WorkStateRow>(
            `UPDATE dispatch.driver_work_states
             SET work_state = $2,
                 current_trip_id = NULL,
                 state_version = state_version + 1,
                 state_changed_at = now(),
                 updated_at = now()
             WHERE driver_user_id = $1
             RETURNING driver_user_id, work_state, state_version, updated_at`,
            [driverUserId, state],
          )
        : await executor.query<WorkStateRow>(
            `INSERT INTO dispatch.driver_work_states (driver_user_id, work_state)
             VALUES ($1, $2)
             RETURNING driver_user_id, work_state, state_version, updated_at`,
            [driverUserId, state],
          );
      return toWorkStateResponse(result.rows[0] as WorkStateRow);
    });
  }

  async startMatching(input: {
    customerUserId: string;
    tripId: string;
    idempotencyKey: string;
    requestFingerprint: Buffer;
    correlationId: string;
  }): Promise<DispatchMatchResponse> {
    return this.database.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.customerUserId}:start-matching:${input.idempotencyKey}`,
      ]);
      const receiptResult = await executor.query<{
        request_fingerprint: Buffer;
        response_body: DispatchMatchResponse;
      }>(
        `SELECT request_fingerprint, response_body
         FROM trip.command_receipts
         WHERE actor_user_id = $1 AND operation = 'START_MATCHING' AND idempotency_key = $2
         FOR UPDATE`,
        [input.customerUserId, input.idempotencyKey],
      );
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (
          !sameDigest(receipt.request_fingerprint, input.requestFingerprint)
        ) {
          throw new DispatchCommandError('IDEMPOTENCY_KEY_REUSED');
        }
        return receipt.response_body;
      }

      const tripResult = await executor.query<TripRow>(
        `SELECT id, customer_user_id, state, version, service_type_code
         FROM trip.trips
         WHERE id = $1 AND customer_user_id = $2
         FOR UPDATE`,
        [input.tripId, input.customerUserId],
      );
      const trip = tripResult.rows[0];
      if (!trip) throw new DispatchCommandError('TRIP_NOT_FOUND');

      if (trip.state !== 'REQUESTED' && trip.state !== 'MATCHING') {
        throw new DispatchCommandError('TRIP_NOT_MATCHABLE');
      }

      let tripState: TripState = trip.state;
      let tripVersion = trip.version;
      if (trip.state === 'REQUESTED') {
        tripVersion += 1;
        await executor.query(
          `UPDATE trip.trips
           SET state = 'MATCHING', version = $2, updated_at = now()
           WHERE id = $1 AND version = $3`,
          [trip.id, tripVersion, trip.version],
        );
        await appendTripTransition(executor, {
          tripId: trip.id,
          actorUserId: null,
          command: 'START_MATCHING',
          fromState: 'REQUESTED',
          toState: 'MATCHING',
          fromVersion: trip.version,
          toVersion: tripVersion,
          correlationId: input.correlationId,
        });
        await appendTripOutbox(
          executor,
          trip.id,
          tripVersion,
          'trip.matching.started',
          {
            tripId: trip.id,
            state: 'MATCHING',
            version: tripVersion,
          },
        );
        tripState = 'MATCHING';
      }

      const pending = await executor.query<OfferRow>(
        `SELECT o.id, o.trip_id, o.driver_user_id, o.attempt_number, o.status,
                o.expires_at, t.state AS trip_state, t.version AS trip_version,
                o.accepted_by_user_id, o.acceptance_idempotency_key
         FROM dispatch.trip_offers o
         JOIN trip.trips t ON t.id = o.trip_id
         WHERE o.trip_id = $1 AND o.status = 'PENDING'
         ORDER BY o.attempt_number DESC
         LIMIT 1
         FOR UPDATE OF o`,
        [trip.id],
      );
      if (pending.rows[0]) {
        const response = {
          tripId: trip.id,
          tripState,
          tripVersion,
          offer: toOfferResponse(pending.rows[0]),
        };
        await persistMatchingReceipt(executor, input, response, trip.id);
        return response;
      }

      const offer = await reserveNextOffer(executor, {
        tripId: trip.id,
        tripState,
        tripVersion,
      });
      if (offer) {
        const response = {
          tripId: trip.id,
          tripState,
          tripVersion,
          offer: toOfferResponse(offer),
        };
        await persistMatchingReceipt(executor, input, response, trip.id);
        return response;
      }

      tripState = 'NO_DRIVER_AVAILABLE';
      tripVersion += 1;
      await executor.query(
        `UPDATE trip.trips
         SET state = 'NO_DRIVER_AVAILABLE', version = $2, updated_at = now()
         WHERE id = $1 AND state = 'MATCHING' AND version = $3`,
        [trip.id, tripVersion, tripVersion - 1],
      );
      await appendTripTransition(executor, {
        tripId: trip.id,
        actorUserId: null,
        command: 'EXHAUST_MATCHING',
        fromState: 'MATCHING',
        toState: 'NO_DRIVER_AVAILABLE',
        fromVersion: tripVersion - 1,
        toVersion: tripVersion,
        correlationId: input.correlationId,
      });
      await appendTripOutbox(
        executor,
        trip.id,
        tripVersion,
        'trip.no_driver_available',
        {
          tripId: trip.id,
          state: tripState,
          version: tripVersion,
        },
      );
      const response = { tripId: trip.id, tripState, tripVersion, offer: null };
      await persistMatchingReceipt(executor, input, response, trip.id);
      return response;
    });
  }

  async rejectOffer(input: {
    driverUserId: string;
    offerId: string;
    idempotencyKey: string;
    requestFingerprint: Buffer;
    correlationId: string;
  }): Promise<RejectResult> {
    return this.database.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.driverUserId}:reject-offer:${input.idempotencyKey}`,
      ]);
      const receiptResult = await executor.query<{
        request_fingerprint: Buffer;
        response_body: DispatchOfferRejectionResponse;
      }>(
        `SELECT request_fingerprint, response_body
         FROM trip.command_receipts
         WHERE actor_user_id = $1 AND operation = 'REJECT_OFFER' AND idempotency_key = $2
         FOR UPDATE`,
        [input.driverUserId, input.idempotencyKey],
      );
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (
          !sameDigest(receipt.request_fingerprint, input.requestFingerprint)
        ) {
          throw new DispatchCommandError('IDEMPOTENCY_KEY_REUSED');
        }
        return { rejected: true, response: receipt.response_body };
      }

      const offerResult = await executor.query<OfferRow>(
        `SELECT o.id, o.trip_id, o.driver_user_id, o.attempt_number, o.status,
                o.expires_at, t.state AS trip_state, t.version AS trip_version,
                o.accepted_by_user_id, o.acceptance_idempotency_key
         FROM dispatch.trip_offers o
         JOIN trip.trips t ON t.id = o.trip_id
         WHERE o.id = $1
         FOR UPDATE OF o, t`,
        [input.offerId],
      );
      const offer = offerResult.rows[0];
      if (!offer) throw new DispatchCommandError('OFFER_NOT_FOUND');
      if (offer.driver_user_id !== input.driverUserId) {
        throw new DispatchCommandError('OFFER_NOT_FOR_DRIVER');
      }
      if (offer.status !== 'PENDING') {
        return { rejected: false, code: 'OFFER_ALREADY_RESOLVED' };
      }

      const reservationResult = await executor.query<{
        id: string;
        expires_at: Date;
        status: 'ACTIVE' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
      }>(
        `SELECT id, expires_at, status
         FROM dispatch.driver_reservations
         WHERE id = (SELECT reservation_id FROM dispatch.trip_offers WHERE id = $1)
         FOR UPDATE`,
        [input.offerId],
      );
      const reservation = reservationResult.rows[0];
      if (!reservation || reservation.status !== 'ACTIVE') {
        return { rejected: false, code: 'OFFER_ALREADY_RESOLVED' };
      }
      if (
        reservation.expires_at.getTime() <= Date.now() ||
        offer.expires_at.getTime() <= Date.now()
      ) {
        await expireOffer(
          executor,
          input.offerId,
          offer.trip_id,
          offer.driver_user_id,
        );
        return { rejected: false, code: 'OFFER_EXPIRED' };
      }
      if (offer.trip_state !== 'MATCHING') {
        return { rejected: false, code: 'OFFER_ALREADY_RESOLVED' };
      }

      await executor.query(
        `UPDATE dispatch.trip_offers
         SET status = 'REJECTED', resolved_at = now(),
             resolution_reason = 'DRIVER_REJECTED', resolved_by_user_id = $2
         WHERE id = $1 AND status = 'PENDING'`,
        [input.offerId, input.driverUserId],
      );
      await executor.query(
        `UPDATE dispatch.driver_reservations
         SET status = 'RELEASED', resolved_at = now(),
             resolution_reason = 'DRIVER_REJECTED', resolved_by_user_id = $2
         WHERE id = $1 AND status = 'ACTIVE'`,
        [reservation.id, input.driverUserId],
      );
      const workStateUpdate = await executor.query(
        `UPDATE dispatch.driver_work_states
         SET work_state = 'AVAILABLE', current_trip_id = NULL,
             state_version = state_version + 1,
             state_changed_at = now(), updated_at = now()
         WHERE driver_user_id = $1 AND work_state = 'RESERVED'
           AND current_trip_id = $2`,
        [input.driverUserId, offer.trip_id],
      );
      if (workStateUpdate.rowCount !== 1) {
        throw new DispatchCommandError('DRIVER_WORK_STATE_CONFLICT');
      }
      const rejectionTripVersion = offer.trip_version + 1;
      const tripVersionUpdate = await executor.query(
        `UPDATE trip.trips
         SET state = 'MATCHING', version = $2, updated_at = now()
         WHERE id = $1 AND state = 'MATCHING' AND version = $3`,
        [offer.trip_id, rejectionTripVersion, offer.trip_version],
      );
      if (tripVersionUpdate.rowCount !== 1) {
        throw new DispatchCommandError('TRIP_NOT_MATCHABLE');
      }
      await appendTripTransition(executor, {
        tripId: offer.trip_id,
        actorUserId: input.driverUserId,
        command: 'REJECT_OFFER',
        fromState: 'MATCHING',
        toState: 'MATCHING',
        fromVersion: offer.trip_version,
        toVersion: rejectionTripVersion,
        correlationId: input.correlationId,
      });
      await appendTripOutbox(
        executor,
        offer.trip_id,
        rejectionTripVersion,
        'dispatch.offer.rejected',
        {
          tripId: offer.trip_id,
          offerId: offer.id,
          driverUserId: input.driverUserId,
          attemptNumber: offer.attempt_number,
          reason: 'DRIVER_REJECTED',
        },
      );

      const reassignedOffer = await reserveNextOffer(executor, {
        tripId: offer.trip_id,
        tripState: offer.trip_state,
        tripVersion: rejectionTripVersion,
        excludedDriverUserId: input.driverUserId,
        reassignment: true,
      });
      let rejectedTripState: TripState = offer.trip_state;
      let rejectedTripVersion = rejectionTripVersion;
      if (!reassignedOffer) {
        rejectedTripState = 'NO_DRIVER_AVAILABLE';
        rejectedTripVersion += 1;
        await executor.query(
          `UPDATE trip.trips
           SET state = 'NO_DRIVER_AVAILABLE', version = $2, updated_at = now()
           WHERE id = $1 AND state = 'MATCHING' AND version = $3`,
          [offer.trip_id, rejectedTripVersion, rejectionTripVersion],
        );
        await appendTripTransition(executor, {
          tripId: offer.trip_id,
          actorUserId: input.driverUserId,
          command: 'EXHAUST_MATCHING_AFTER_REJECT',
          fromState: 'MATCHING',
          toState: rejectedTripState,
          fromVersion: rejectionTripVersion,
          toVersion: rejectedTripVersion,
          correlationId: input.correlationId,
        });
        await appendTripOutbox(
          executor,
          offer.trip_id,
          rejectedTripVersion,
          'trip.no_driver_available',
          {
            tripId: offer.trip_id,
            state: rejectedTripState,
            version: rejectedTripVersion,
          },
        );
      }

      const response: DispatchOfferRejectionResponse = {
        rejectedOffer: {
          ...toOfferResponse(offer),
          status: 'REJECTED',
          tripState: rejectedTripState,
          tripVersion: rejectedTripVersion,
        },
        reassignedOffer: reassignedOffer
          ? toOfferResponse(reassignedOffer)
          : null,
      };
      await persistRejectionReceipt(executor, input, response, offer.trip_id);
      return { rejected: true, response };
    });
  }

  async expireDueOffers(): Promise<number> {
    return this.database.transaction(async (executor) => {
      const due = await executor.query<DueOfferRow>(
        `SELECT o.id, o.trip_id, o.driver_user_id, o.expires_at,
                now() AS database_now,
                t.state AS trip_state, t.version AS trip_version,
                r.status AS reservation_status, ws.work_state
         FROM dispatch.trip_offers o
         JOIN trip.trips t ON t.id = o.trip_id
         LEFT JOIN dispatch.driver_reservations r ON r.id = o.reservation_id
         LEFT JOIN dispatch.driver_work_states ws
           ON ws.driver_user_id = o.driver_user_id
         WHERE o.status = 'PENDING' AND o.expires_at <= now()
         ORDER BY o.expires_at ASC, o.id ASC
         LIMIT 100
         FOR UPDATE OF o, t SKIP LOCKED`,
      );
      let processed = 0;
      for (const offer of due.rows) {
        const decision = evaluateDispatchExpiry({
          nowEpochMs: offer.database_now.getTime(),
          offerExpiresAtEpochMs: offer.expires_at.getTime(),
          offerState: 'PENDING',
          reservationState: offer.reservation_status ?? 'RELEASED',
          workState: offer.work_state ?? 'AVAILABLE',
          tripState: offer.trip_state,
        });
        if (decision.outcome !== 'EXPIRED_AND_RELEASED') continue;

        await expireOffer(
          executor,
          offer.id,
          offer.trip_id,
          offer.driver_user_id,
        );
        await appendTripOutbox(
          executor,
          offer.trip_id,
          offer.trip_version,
          'dispatch.offer.expired',
          {
            tripId: offer.trip_id,
            offerId: offer.id,
            driverUserId: offer.driver_user_id,
            reason: 'OFFER_EXPIRED',
          },
        );

        if (offer.trip_state === 'MATCHING') {
          const reassignedOffer = await reserveNextOffer(executor, {
            tripId: offer.trip_id,
            tripState: offer.trip_state,
            tripVersion: offer.trip_version,
            excludedDriverUserId: offer.driver_user_id,
            reassignment: true,
          });
          if (!reassignedOffer) {
            const nextVersion = offer.trip_version + 1;
            await executor.query(
              `UPDATE trip.trips
               SET state = 'NO_DRIVER_AVAILABLE', version = $2, updated_at = now()
               WHERE id = $1 AND state = 'MATCHING' AND version = $3`,
              [offer.trip_id, nextVersion, offer.trip_version],
            );
            await appendTripTransition(executor, {
              tripId: offer.trip_id,
              actorUserId: null,
              command: 'EXPIRE_OFFER_NO_REASSIGNMENT',
              fromState: 'MATCHING',
              toState: 'NO_DRIVER_AVAILABLE',
              fromVersion: offer.trip_version,
              toVersion: nextVersion,
              correlationId: offer.id,
            });
            await appendTripOutbox(
              executor,
              offer.trip_id,
              nextVersion,
              'trip.no_driver_available',
              {
                tripId: offer.trip_id,
                state: 'NO_DRIVER_AVAILABLE',
                version: nextVersion,
              },
            );
          }
        }
        processed += 1;
      }
      return processed;
    });
  }

  async acceptOffer(input: {
    driverUserId: string;
    offerId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<AcceptResult> {
    return this.database.transaction(async (executor) => {
      const offerResult = await executor.query<OfferRow>(
        `SELECT o.id, o.trip_id, o.driver_user_id, o.attempt_number, o.status,
                o.expires_at, t.state AS trip_state, t.version AS trip_version,
                o.accepted_by_user_id, o.acceptance_idempotency_key
         FROM dispatch.trip_offers o
         JOIN trip.trips t ON t.id = o.trip_id
         WHERE o.id = $1
         FOR UPDATE OF o, t`,
        [input.offerId],
      );
      const offer = offerResult.rows[0];
      if (!offer) throw new DispatchCommandError('OFFER_NOT_FOUND');
      if (offer.driver_user_id !== input.driverUserId) {
        throw new DispatchCommandError('OFFER_NOT_FOR_DRIVER');
      }
      if (offer.status === 'ACCEPTED') {
        if (offer.acceptance_idempotency_key === input.idempotencyKey) {
          return { accepted: true, response: toOfferResponse(offer) };
        }
        return { accepted: false, code: 'OFFER_ALREADY_RESOLVED' };
      }
      if (offer.status !== 'PENDING') {
        return { accepted: false, code: 'OFFER_ALREADY_RESOLVED' };
      }

      const reservationResult = await executor.query<{
        id: string;
        expires_at: Date;
        status: 'ACTIVE' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
      }>(
        `SELECT id, expires_at, status
         FROM dispatch.driver_reservations
         WHERE id = (SELECT reservation_id FROM dispatch.trip_offers WHERE id = $1)
         FOR UPDATE`,
        [input.offerId],
      );
      const reservation = reservationResult.rows[0];
      if (!reservation || reservation.status !== 'ACTIVE') {
        return { accepted: false, code: 'OFFER_ALREADY_RESOLVED' };
      }
      if (
        reservation.expires_at.getTime() <= Date.now() ||
        offer.expires_at.getTime() <= Date.now()
      ) {
        await expireOffer(
          executor,
          input.offerId,
          offer.trip_id,
          offer.driver_user_id,
        );
        return { accepted: false, code: 'OFFER_EXPIRED' };
      }
      if (offer.trip_state !== 'MATCHING') {
        return { accepted: false, code: 'OFFER_ALREADY_RESOLVED' };
      }

      const nextVersion = offer.trip_version + 1;
      await executor.query(
        `UPDATE dispatch.trip_offers
         SET status = 'ACCEPTED', resolved_at = now(), resolved_by_user_id = $2,
             accepted_at = now(), accepted_by_user_id = $2,
             acceptance_idempotency_key = $3,
             acceptance_correlation_id = $4,
             accepted_trip_version = $5
         WHERE id = $1 AND status = 'PENDING'`,
        [
          input.offerId,
          input.driverUserId,
          input.idempotencyKey,
          input.correlationId,
          nextVersion,
        ],
      );
      await executor.query(
        `UPDATE dispatch.driver_reservations
         SET status = 'COMMITTED', resolved_at = now(),
             resolution_reason = 'OFFER_ACCEPTED', resolved_by_user_id = $2
         WHERE id = $1 AND status = 'ACTIVE'`,
        [reservation.id, input.driverUserId],
      );
      await executor.query(
        `UPDATE dispatch.driver_work_states
         SET work_state = 'TO_PICKUP', current_trip_id = $2,
             state_version = state_version + 1,
             state_changed_at = now(), updated_at = now()
         WHERE driver_user_id = $1 AND work_state = 'RESERVED'
           AND current_trip_id = $2`,
        [input.driverUserId, offer.trip_id],
      );
      await executor.query(
        `UPDATE trip.trips
         SET state = 'DRIVER_TO_PICKUP', version = $2, updated_at = now()
         WHERE id = $1 AND state = 'MATCHING' AND version = $3`,
        [offer.trip_id, nextVersion, offer.trip_version],
      );
      await appendTripTransition(executor, {
        tripId: offer.trip_id,
        actorUserId: input.driverUserId,
        command: 'ASSIGN_DRIVER',
        fromState: 'MATCHING',
        toState: 'DRIVER_TO_PICKUP',
        fromVersion: offer.trip_version,
        toVersion: nextVersion,
        correlationId: input.correlationId,
      });
      await appendTripOutbox(
        executor,
        offer.trip_id,
        nextVersion,
        'trip.driver.assigned',
        {
          tripId: offer.trip_id,
          driverUserId: input.driverUserId,
          offerId: input.offerId,
          state: 'DRIVER_TO_PICKUP',
          version: nextVersion,
        },
      );
      return {
        accepted: true,
        response: {
          ...toOfferResponse(offer),
          status: 'ACCEPTED',
          tripState: 'DRIVER_TO_PICKUP',
          tripVersion: nextVersion,
        },
      };
    });
  }
}

async function reserveNextOffer(
  executor: DatabaseExecutor,
  input: {
    tripId: string;
    tripState: TripState;
    tripVersion: number;
    excludedDriverUserId?: string;
    reassignment?: boolean;
  },
): Promise<OfferRow | null> {
  const attemptNumber = await nextAttempt(executor, input.tripId);
  if (attemptNumber > MAX_OFFER_ATTEMPTS) return null;

  const candidates = await executor.query<CandidateRow>(
    `SELECT ws.driver_user_id,
            ST_Distance(loc.location, t.pickup_location)::double precision AS distance_meters,
            EXTRACT(EPOCH FROM (now() - loc.received_at))::double precision AS freshness_age_seconds
     FROM trip.trips t
     JOIN location.latest_driver_locations loc ON true
     JOIN dispatch.driver_work_states ws ON ws.driver_user_id = loc.driver_user_id
     JOIN driver.driver_profiles p ON p.user_id = ws.driver_user_id
     JOIN driver.vehicles v ON v.driver_user_id = ws.driver_user_id
     WHERE t.id = $1
       AND ($5::uuid IS NULL OR ws.driver_user_id <> $5::uuid)
       AND ws.work_state = 'AVAILABLE'
       AND p.approval_status = 'APPROVED'
       AND p.deactivated_at IS NULL
       AND v.approval_status = 'APPROVED'
       AND v.is_selected = true
       AND v.vehicle_class = CASE t.service_type_code
         WHEN 'MOTORBIKE_STANDARD' THEN 'MOTORBIKE'
         WHEN 'CAR_STANDARD' THEN 'STANDARD_CAR'
       END
       AND loc.received_at >= now() - ($2::integer * INTERVAL '1 second')
       AND ST_DWithin(loc.location, t.pickup_location, $3)
       AND NOT EXISTS (
         SELECT 1 FROM dispatch.driver_reservations r
         WHERE r.driver_user_id = ws.driver_user_id AND r.status = 'ACTIVE'
       )
       AND NOT EXISTS (
         SELECT 1 FROM dispatch.trip_offers previous_offer
         WHERE previous_offer.trip_id = t.id
           AND previous_offer.driver_user_id = ws.driver_user_id
       )
     ORDER BY distance_meters, ws.state_changed_at, ws.driver_user_id
     LIMIT $4
     FOR UPDATE OF ws SKIP LOCKED`,
    [
      input.tripId,
      LOCATION_FRESHNESS_SECONDS,
      SEARCH_RADIUS_METERS,
      MAX_CANDIDATES,
      input.excludedDriverUserId ?? null,
    ],
  );
  const ranked = rankEligibleDriverCandidates(
    candidates.rows.map((candidate) => ({
      driverId: candidate.driver_user_id,
      distanceMeters: candidate.distance_meters,
      freshnessAgeSeconds: candidate.freshness_age_seconds,
      eligible: true,
    })),
    { maxFreshnessAgeSeconds: LOCATION_FRESHNESS_SECONDS },
  );

  for (const candidate of ranked) {
    const reservation = await executor.query<{
      id: string;
      expires_at: Date;
    }>(
      `INSERT INTO dispatch.driver_reservations (
         id, driver_user_id, trip_id, expires_at
       ) VALUES ($1, $2, $3, now() + ($4::integer * INTERVAL '1 second'))
       ON CONFLICT DO NOTHING
       RETURNING id, expires_at`,
      [randomUUID(), candidate.driverId, input.tripId, OFFER_TTL_SECONDS],
    );
    if (!reservation.rows[0]) continue;

    const stateUpdate = await executor.query(
      `UPDATE dispatch.driver_work_states
       SET work_state = 'RESERVED', current_trip_id = $2,
           state_version = state_version + 1,
           state_changed_at = now(), updated_at = now()
       WHERE driver_user_id = $1 AND work_state = 'AVAILABLE'
         AND current_trip_id IS NULL`,
      [candidate.driverId, input.tripId],
    );
    if (stateUpdate.rowCount !== 1) {
      await releaseReservation(
        executor,
        reservation.rows[0].id,
        'WORK_STATE_CHANGED',
      );
      continue;
    }

    const offer = await executor.query<OfferRow>(
      `INSERT INTO dispatch.trip_offers (
         id, trip_id, reservation_id, driver_user_id, attempt_number, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, trip_id, driver_user_id, attempt_number, status,
                 expires_at, $7::text AS trip_state, $8::integer AS trip_version,
                 accepted_by_user_id, acceptance_idempotency_key`,
      [
        randomUUID(),
        input.tripId,
        reservation.rows[0].id,
        candidate.driverId,
        attemptNumber,
        reservation.rows[0].expires_at,
        input.tripState,
        input.tripVersion,
      ],
    );
    await appendTripOutbox(
      executor,
      input.tripId,
      input.tripVersion,
      input.reassignment
        ? 'dispatch.offer.reassigned'
        : 'dispatch.offer.created',
      {
        tripId: input.tripId,
        offerId: offer.rows[0]?.id,
        driverUserId: candidate.driverId,
        attemptNumber: offer.rows[0]?.attempt_number,
        expiresAt: offer.rows[0]?.expires_at,
      },
    );
    return offer.rows[0] as OfferRow;
  }

  return null;
}

async function nextAttempt(
  executor: DatabaseExecutor,
  tripId: string,
): Promise<number> {
  const result = await executor.query<{ next_attempt: number }>(
    `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt
     FROM dispatch.trip_offers WHERE trip_id = $1`,
    [tripId],
  );
  return result.rows[0]?.next_attempt ?? 1;
}

function toWorkStateResponse(row: WorkStateRow): WorkStateResponse {
  return {
    driverId: row.driver_user_id,
    state: row.work_state,
    stateVersion: Number(row.state_version),
    updatedAt: row.updated_at.toISOString(),
  };
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

function toOfferResponse(row: OfferRow): TripOfferResponse {
  return {
    id: row.id,
    tripId: row.trip_id,
    driverId: row.driver_user_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    tripState: row.trip_state,
    tripVersion: row.trip_version,
  };
}

async function releaseReservation(
  executor: DatabaseExecutor,
  reservationId: string,
  reason: string,
): Promise<void> {
  await executor.query(
    `UPDATE dispatch.driver_reservations
     SET status = 'RELEASED', resolved_at = now(), resolution_reason = $2
     WHERE id = $1 AND status = 'ACTIVE'`,
    [reservationId, reason],
  );
}

async function expireOffer(
  executor: DatabaseExecutor,
  offerId: string,
  tripId: string,
  driverUserId: string,
): Promise<void> {
  await executor.query(
    `UPDATE dispatch.trip_offers
     SET status = 'EXPIRED', resolved_at = now(), resolution_reason = 'OFFER_EXPIRED',
         resolved_by_user_id = $2
     WHERE id = $1 AND status = 'PENDING'`,
    [offerId, driverUserId],
  );
  await executor.query(
    `UPDATE dispatch.driver_reservations
     SET status = 'EXPIRED', resolved_at = now(), resolution_reason = 'OFFER_EXPIRED',
         resolved_by_user_id = $2
     WHERE trip_id = $1 AND driver_user_id = $2 AND status = 'ACTIVE'`,
    [tripId, driverUserId],
  );
  await executor.query(
    `UPDATE dispatch.driver_work_states
     SET work_state = 'AVAILABLE', current_trip_id = NULL,
         state_version = state_version + 1,
         state_changed_at = now(), updated_at = now()
     WHERE driver_user_id = $1 AND work_state = 'RESERVED' AND current_trip_id = $2`,
    [driverUserId, tripId],
  );
}

async function appendTripTransition(
  executor: DatabaseExecutor,
  input: {
    tripId: string;
    actorUserId: string | null;
    command: string;
    fromState: TripState | null;
    toState: TripState;
    fromVersion: number | null;
    toVersion: number;
    correlationId: string;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO trip.state_transitions (
       id, trip_id, actor_user_id, command, from_state, to_state,
       from_version, to_version, correlation_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      input.tripId,
      input.actorUserId,
      input.command,
      input.fromState,
      input.toState,
      input.fromVersion,
      input.toVersion,
      input.correlationId,
    ],
  );
}

async function appendTripOutbox(
  executor: DatabaseExecutor,
  tripId: string,
  version: number,
  eventType: string,
  payload: unknown,
): Promise<void> {
  await executor.query(
    `INSERT INTO trip.outbox_events (id, trip_id, aggregate_version, event_type, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), tripId, version, eventType, JSON.stringify(payload)],
  );
}

async function persistMatchingReceipt(
  executor: DatabaseExecutor,
  input: {
    customerUserId: string;
    tripId: string;
    idempotencyKey: string;
    requestFingerprint: Buffer;
  },
  response: DispatchMatchResponse,
  tripId: string,
): Promise<void> {
  await executor.query(
    `INSERT INTO trip.command_receipts (
       actor_user_id, operation, idempotency_key, request_fingerprint, response_body, trip_id
     ) VALUES ($1, 'START_MATCHING', $2, $3, $4, $5)`,
    [
      input.customerUserId,
      input.idempotencyKey,
      input.requestFingerprint,
      JSON.stringify(response),
      tripId,
    ],
  );
}

async function persistRejectionReceipt(
  executor: DatabaseExecutor,
  input: {
    driverUserId: string;
    idempotencyKey: string;
    requestFingerprint: Buffer;
  },
  response: DispatchOfferRejectionResponse,
  tripId: string,
): Promise<void> {
  await executor.query(
    `INSERT INTO trip.command_receipts (
       actor_user_id, operation, idempotency_key, request_fingerprint, response_body, trip_id
     ) VALUES ($1, 'REJECT_OFFER', $2, $3, $4, $5)`,
    [
      input.driverUserId,
      input.idempotencyKey,
      input.requestFingerprint,
      JSON.stringify(response),
      tripId,
    ],
  );
}
