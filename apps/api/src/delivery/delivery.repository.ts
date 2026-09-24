import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type {
  DeliveryMatchResponse,
  DeliveryOfferResponse,
  DeliveryResponse,
} from '@gove/contracts';
import type { QueryResultRow } from 'pg';

import { DatabaseService } from '../database/database.service.js';
import type { CreateDeliveryInput } from './delivery.schemas.js';

interface DeliveryRow extends QueryResultRow {
  id: string;
  created_at: Date;
}

interface DeliveryDetailRow extends QueryResultRow {
  id: string;
  state: DeliveryResponse['state'];
  version: number;
  pickup_label: string;
  pickup_longitude: string;
  pickup_latitude: string;
  dropoff_label: string;
  dropoff_longitude: string;
  dropoff_latitude: string;
  recipient_display_name: string;
  parcel_description: string;
  declared_weight_grams: number;
  created_at: Date;
}

export interface CreateDeliveryRecord extends CreateDeliveryInput {
  customerUserId: string;
  idempotencyKey: string;
  requestFingerprint: Buffer;
  correlationId: string;
}

@Injectable()
export class DeliveryRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async createDelivery(input: CreateDeliveryRecord): Promise<DeliveryResponse> {
    return this.database.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.customerUserId}:create-delivery:${input.idempotencyKey}`,
      ]);
      const receipt = await executor.query<{
        request_fingerprint: Buffer;
        response_body: DeliveryResponse;
      }>(
        `SELECT request_fingerprint, response_body
         FROM delivery.command_receipts
         WHERE actor_user_id = $1
           AND operation = 'CREATE_DELIVERY'
           AND idempotency_key = $2
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
          throw new DeliveryCommandError('IDEMPOTENCY_KEY_REUSED');
        }
        return existingReceipt.response_body;
      }

      const deliveryId = randomUUID();
      const created = await executor.query<DeliveryRow>(
        `INSERT INTO delivery.deliveries (
          id, customer_user_id,
          pickup_label, pickup_location, dropoff_label, dropoff_location,
          recipient_display_name, recipient_contact_phone,
          parcel_description, declared_weight_grams
        ) VALUES (
          $1, $2,
          $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
          $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
          $9, $10, $11, $12
        ) RETURNING id, created_at`,
        [
          deliveryId,
          input.customerUserId,
          input.pickup.label,
          input.pickup.longitude,
          input.pickup.latitude,
          input.dropoff.label,
          input.dropoff.longitude,
          input.dropoff.latitude,
          input.recipient.displayName,
          input.recipient.contactPhone,
          input.parcel.description,
          input.parcel.declaredWeightGrams,
        ],
      );
      const result: DeliveryResponse = {
        id: deliveryId,
        state: 'REQUESTED',
        version: 0,
        pickup: input.pickup,
        dropoff: input.dropoff,
        recipientDisplayName: input.recipient.displayName,
        parcelDescription: input.parcel.description,
        declaredWeightGrams: input.parcel.declaredWeightGrams,
        createdAt: (created.rows[0] as DeliveryRow).created_at.toISOString(),
      };
      await executor.query(
        `INSERT INTO delivery.state_transitions (
          id, delivery_id, actor_user_id, command, to_state, to_version, correlation_id
        ) VALUES ($1, $2, $3, 'CREATE_DELIVERY', 'REQUESTED', 0, $4)`,
        [randomUUID(), deliveryId, input.customerUserId, input.correlationId],
      );
      await executor.query(
        `INSERT INTO delivery.outbox_events (
          id, delivery_id, aggregate_version, event_type, payload
        ) VALUES ($1, $2, 0, 'delivery.created', $3)`,
        [
          randomUUID(),
          deliveryId,
          JSON.stringify({
            deliveryId,
            customerUserId: input.customerUserId,
            state: 'REQUESTED',
            version: 0,
          }),
        ],
      );
      await executor.query(
        `INSERT INTO delivery.command_receipts (
          actor_user_id, operation, idempotency_key, request_fingerprint,
          response_body, delivery_id
        ) VALUES ($1, 'CREATE_DELIVERY', $2, $3, $4, $5)`,
        [
          input.customerUserId,
          input.idempotencyKey,
          input.requestFingerprint,
          JSON.stringify(result),
          deliveryId,
        ],
      );
      return result;
    });
  }

  async findForCustomer(
    customerUserId: string,
    deliveryId: string,
  ): Promise<DeliveryResponse | null> {
    const result = await this.database.query<DeliveryDetailRow>(
      `SELECT id, state, version,
              pickup_label,
              ST_X(pickup_location::geometry) AS pickup_longitude,
              ST_Y(pickup_location::geometry) AS pickup_latitude,
              dropoff_label,
              ST_X(dropoff_location::geometry) AS dropoff_longitude,
              ST_Y(dropoff_location::geometry) AS dropoff_latitude,
              recipient_display_name, parcel_description, declared_weight_grams,
              created_at
       FROM delivery.deliveries
       WHERE id = $1 AND customer_user_id = $2`,
      [deliveryId, customerUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      state: row.state,
      version: row.version,
      pickup: {
        label: row.pickup_label,
        latitude: finiteNumber(row.pickup_latitude),
        longitude: finiteNumber(row.pickup_longitude),
      },
      dropoff: {
        label: row.dropoff_label,
        latitude: finiteNumber(row.dropoff_latitude),
        longitude: finiteNumber(row.dropoff_longitude),
      },
      recipientDisplayName: row.recipient_display_name,
      parcelDescription: row.parcel_description,
      declaredWeightGrams: row.declared_weight_grams,
      createdAt: row.created_at.toISOString(),
    };
  }

  async listForCustomer(customerUserId: string): Promise<DeliveryResponse[]> {
    const result = await this.database.query<DeliveryDetailRow>(
      `SELECT id, state, version, pickup_label,
              ST_X(pickup_location::geometry) AS pickup_longitude, ST_Y(pickup_location::geometry) AS pickup_latitude,
              dropoff_label, ST_X(dropoff_location::geometry) AS dropoff_longitude, ST_Y(dropoff_location::geometry) AS dropoff_latitude,
              recipient_display_name, parcel_description, declared_weight_grams, created_at
       FROM delivery.deliveries WHERE customer_user_id = $1 ORDER BY created_at DESC, id DESC`,
      [customerUserId],
    );
    return result.rows.map(toDeliveryResponse);
  }

  async listActiveForCustomer(
    customerUserId: string,
  ): Promise<DeliveryResponse[]> {
    const result = await this.database.query<DeliveryDetailRow>(
      `SELECT id, state, version, pickup_label,
              ST_X(pickup_location::geometry) AS pickup_longitude,
              ST_Y(pickup_location::geometry) AS pickup_latitude,
              dropoff_label,
              ST_X(dropoff_location::geometry) AS dropoff_longitude,
              ST_Y(dropoff_location::geometry) AS dropoff_latitude,
              recipient_display_name, parcel_description, declared_weight_grams,
              created_at
       FROM delivery.deliveries
       WHERE customer_user_id = $1
         AND state IN ('REQUESTED', 'MATCHING', 'DRIVER_TO_PICKUP', 'AT_PICKUP', 'IN_TRANSIT')
       ORDER BY created_at DESC, id DESC`,
      [customerUserId],
    );
    return result.rows.map(toDeliveryResponse);
  }

  async findForDriver(
    driverUserId: string,
    deliveryId: string,
  ): Promise<DeliveryResponse | null> {
    const result = await this.database.query<DeliveryDetailRow>(
      `SELECT d.id, d.state, d.version, d.pickup_label,
              ST_X(d.pickup_location::geometry) AS pickup_longitude,
              ST_Y(d.pickup_location::geometry) AS pickup_latitude,
              d.dropoff_label,
              ST_X(d.dropoff_location::geometry) AS dropoff_longitude,
              ST_Y(d.dropoff_location::geometry) AS dropoff_latitude,
              d.recipient_display_name, d.parcel_description, d.declared_weight_grams,
              d.created_at
       FROM delivery.deliveries d
       JOIN delivery.assignments a ON a.delivery_id = d.id
       WHERE d.id = $1 AND a.driver_user_id = $2
       ORDER BY a.accepted_at DESC LIMIT 1`,
      [deliveryId, driverUserId],
    );
    const row = result.rows[0];
    return row ? toDeliveryResponse(row) : null;
  }

  async listPendingOffers(
    driverUserId: string,
  ): Promise<DeliveryOfferResponse[]> {
    const result = await this.database.query<OfferRow>(
      `SELECT o.id, o.delivery_id, o.driver_user_id, o.attempt_number, o.status,
              o.expires_at, d.state AS delivery_state, d.version AS delivery_version,
              o.acceptance_idempotency_key
       FROM delivery.delivery_offers o
       JOIN delivery.deliveries d ON d.id = o.delivery_id
       WHERE o.driver_user_id = $1 AND o.status = 'PENDING'
       ORDER BY o.offered_at ASC, o.id ASC`,
      [driverUserId],
    );
    return result.rows.map(toOfferResponse);
  }

  async findCurrentForDriver(
    driverUserId: string,
  ): Promise<DeliveryResponse | null> {
    const result = await this.database.query<DeliveryDetailRow>(
      `SELECT d.id, d.state, d.version, d.pickup_label,
              ST_X(d.pickup_location::geometry) AS pickup_longitude,
              ST_Y(d.pickup_location::geometry) AS pickup_latitude,
              d.dropoff_label,
              ST_X(d.dropoff_location::geometry) AS dropoff_longitude,
              ST_Y(d.dropoff_location::geometry) AS dropoff_latitude,
              d.recipient_display_name, d.parcel_description, d.declared_weight_grams,
              d.created_at
       FROM delivery.assignments a
       JOIN delivery.deliveries d ON d.id = a.delivery_id
       WHERE a.driver_user_id = $1 AND a.status = 'ACTIVE'
       ORDER BY a.accepted_at DESC LIMIT 1`,
      [driverUserId],
    );
    const row = result.rows[0];
    return row ? toDeliveryResponse(row) : null;
  }

  async startMatching(input: {
    customerUserId: string;
    deliveryId: string;
    idempotencyKey: string;
    requestFingerprint: Buffer;
    correlationId: string;
  }): Promise<DeliveryMatchResponse> {
    return this.database.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.customerUserId}:start-delivery-matching:${input.idempotencyKey}`,
      ]);
      const prior = await executor.query<{
        request_fingerprint: Buffer;
        response_body: DeliveryMatchResponse;
      }>(
        `SELECT request_fingerprint, response_body FROM delivery.command_receipts
         WHERE actor_user_id = $1 AND operation = 'START_MATCHING' AND idempotency_key = $2 FOR UPDATE`,
        [input.customerUserId, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (
          !sameDigest(
            prior.rows[0].request_fingerprint,
            input.requestFingerprint,
          )
        )
          throw new DeliveryCommandError('IDEMPOTENCY_KEY_REUSED');
        return prior.rows[0].response_body;
      }
      const delivery = await executor.query<{
        state: DeliveryResponse['state'];
        version: number;
      }>(
        `SELECT state, version FROM delivery.deliveries WHERE id = $1 AND customer_user_id = $2 FOR UPDATE`,
        [input.deliveryId, input.customerUserId],
      );
      const row = delivery.rows[0];
      if (!row) throw new DeliveryCommandError('DELIVERY_NOT_FOUND');
      if (row.state !== 'REQUESTED')
        throw new DeliveryCommandError('DELIVERY_NOT_MATCHABLE');
      const version = row.version + 1;
      await executor.query(
        `UPDATE delivery.deliveries SET state = 'MATCHING', version = $2, updated_at = now() WHERE id = $1 AND state = 'REQUESTED' AND version = $3`,
        [input.deliveryId, version, row.version],
      );
      await appendTransition(
        executor,
        input.deliveryId,
        input.customerUserId,
        'START_MATCHING',
        'REQUESTED',
        'MATCHING',
        row.version,
        version,
        input.correlationId,
      );
      await appendDeliveryOutboxEvent(
        executor,
        input.deliveryId,
        version,
        'delivery.matching.started',
        {
          deliveryId: input.deliveryId,
          customerUserId: input.customerUserId,
          state: 'MATCHING',
          version,
        },
      );
      const offer = await reserveOffer(executor, input.deliveryId, version);
      const response: DeliveryMatchResponse = {
        deliveryId: input.deliveryId,
        deliveryState: offer ? 'MATCHING' : 'NO_DRIVER_AVAILABLE',
        deliveryVersion: offer ? version : version + 1,
        offer,
      };
      if (!offer) {
        await executor.query(
          `UPDATE delivery.deliveries SET state = 'NO_DRIVER_AVAILABLE', version = $2, updated_at = now() WHERE id = $1 AND state = 'MATCHING' AND version = $3`,
          [input.deliveryId, version + 1, version],
        );
        await appendTransition(
          executor,
          input.deliveryId,
          null,
          'NO_ELIGIBLE_DRIVER',
          'MATCHING',
          'NO_DRIVER_AVAILABLE',
          version,
          version + 1,
          input.correlationId,
        );
        await appendDeliveryOutboxEvent(
          executor,
          input.deliveryId,
          version + 1,
          'delivery.no_driver_available',
          {
            deliveryId: input.deliveryId,
            state: 'NO_DRIVER_AVAILABLE',
            version: version + 1,
          },
        );
      }
      await executor.query(
        `INSERT INTO delivery.command_receipts (actor_user_id, operation, idempotency_key, request_fingerprint, response_body, delivery_id) VALUES ($1, 'START_MATCHING', $2, $3, $4, $5)`,
        [
          input.customerUserId,
          input.idempotencyKey,
          input.requestFingerprint,
          JSON.stringify(response),
          input.deliveryId,
        ],
      );
      return response;
    });
  }

  async acceptOffer(input: {
    driverUserId: string;
    offerId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<DeliveryOfferResponse> {
    return this.database.transaction(async (executor) => {
      const result = await executor.query<OfferRow>(
        `SELECT o.id, o.delivery_id, o.driver_user_id, o.attempt_number, o.status, o.expires_at,
                d.state AS delivery_state, d.version AS delivery_version, o.acceptance_idempotency_key
         FROM delivery.delivery_offers o JOIN delivery.deliveries d ON d.id = o.delivery_id
         WHERE o.id = $1 FOR UPDATE OF o, d`,
        [input.offerId],
      );
      const offer = result.rows[0];
      if (!offer) throw new DeliveryCommandError('OFFER_NOT_FOUND');
      if (offer.driver_user_id !== input.driverUserId)
        throw new DeliveryCommandError('OFFER_NOT_FOR_DRIVER');
      if (
        offer.status === 'ACCEPTED' &&
        offer.acceptance_idempotency_key === input.idempotencyKey
      )
        return toOfferResponse(offer);
      if (offer.status !== 'PENDING')
        throw new DeliveryCommandError('OFFER_ALREADY_RESOLVED');
      const reservation = await executor.query<{
        id: string;
        status: string;
        expires_at: Date;
      }>(
        `SELECT id, status, expires_at FROM delivery.driver_reservations WHERE id = (SELECT reservation_id FROM delivery.delivery_offers WHERE id = $1) FOR UPDATE`,
        [input.offerId],
      );
      if (!reservation.rows[0] || reservation.rows[0].status !== 'ACTIVE')
        throw new DeliveryCommandError('OFFER_ALREADY_RESOLVED');
      if (
        reservation.rows[0].expires_at.getTime() <= Date.now() ||
        offer.expires_at.getTime() <= Date.now()
      ) {
        await expireDeliveryOffer(executor, offer);
        throw new DeliveryCommandError('OFFER_EXPIRED');
      }
      if (offer.delivery_state !== 'MATCHING')
        throw new DeliveryCommandError('OFFER_ALREADY_RESOLVED');
      const nextVersion = offer.delivery_version + 1;
      const work = await executor.query(
        `UPDATE dispatch.driver_work_states SET work_state = 'TO_PICKUP', current_delivery_id = $2, state_version = state_version + 1, state_changed_at = now(), updated_at = now() WHERE driver_user_id = $1 AND work_state = 'RESERVED' AND current_delivery_id = $2 AND current_trip_id IS NULL`,
        [input.driverUserId, offer.delivery_id],
      );
      if (work.rowCount !== 1)
        throw new DeliveryCommandError('DRIVER_WORK_STATE_CONFLICT');
      await executor.query(
        `UPDATE delivery.driver_reservations SET status = 'COMMITTED', resolved_at = now(), resolution_reason = 'OFFER_ACCEPTED', resolved_by_user_id = $2 WHERE id = $1 AND status = 'ACTIVE'`,
        [reservation.rows[0].id, input.driverUserId],
      );
      await executor.query(
        `UPDATE delivery.delivery_offers SET status = 'ACCEPTED', resolved_at = now(), resolution_reason = 'OFFER_ACCEPTED', accepted_by_user_id = $2, acceptance_idempotency_key = $3, accepted_delivery_version = $4 WHERE id = $1 AND status = 'PENDING'`,
        [input.offerId, input.driverUserId, input.idempotencyKey, nextVersion],
      );
      await executor.query(
        `INSERT INTO delivery.assignments (id, delivery_id, offer_id, driver_user_id) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), offer.delivery_id, offer.id, input.driverUserId],
      );
      await executor.query(
        `UPDATE delivery.deliveries SET state = 'DRIVER_TO_PICKUP', version = $2, updated_at = now() WHERE id = $1 AND state = 'MATCHING' AND version = $3`,
        [offer.delivery_id, nextVersion, offer.delivery_version],
      );
      await appendTransition(
        executor,
        offer.delivery_id,
        input.driverUserId,
        'ASSIGN_DRIVER',
        'MATCHING',
        'DRIVER_TO_PICKUP',
        offer.delivery_version,
        nextVersion,
        input.correlationId,
      );
      await appendDeliveryOutboxEvent(
        executor,
        offer.delivery_id,
        nextVersion,
        'delivery.driver.assigned',
        {
          deliveryId: offer.delivery_id,
          driverUserId: input.driverUserId,
          state: 'DRIVER_TO_PICKUP',
          version: nextVersion,
        },
      );
      return {
        ...toOfferResponse(offer),
        status: 'ACCEPTED',
        deliveryState: 'DRIVER_TO_PICKUP',
        deliveryVersion: nextVersion,
      };
    });
  }

  async transitionAssignedDelivery(input: {
    driverUserId: string;
    deliveryId: string;
    action: 'ARRIVE_AT_PICKUP' | 'CONFIRM_PICKUP_CUSTODY' | 'COMPLETE_DELIVERY';
    idempotencyKey: string;
    requestFingerprint: Buffer;
    correlationId: string;
    confirmation?: string;
  }): Promise<DeliveryResponse> {
    return this.database.transaction(async (executor) => {
      const operation = `DELIVERY_${input.action}`;
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.driverUserId}:${operation}:${input.idempotencyKey}`,
      ]);
      const prior = await executor.query<{
        request_fingerprint: Buffer;
        response_body: DeliveryResponse;
      }>(
        `SELECT request_fingerprint, response_body FROM delivery.command_receipts
         WHERE actor_user_id = $1 AND operation = $2 AND idempotency_key = $3 FOR UPDATE`,
        [input.driverUserId, operation, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (
          !sameDigest(
            prior.rows[0].request_fingerprint,
            input.requestFingerprint,
          )
        )
          throw new DeliveryCommandError('IDEMPOTENCY_KEY_REUSED');
        return prior.rows[0].response_body;
      }
      const assigned = await executor.query<AssignedDeliveryRow>(
        `SELECT d.id, d.state, d.version, d.pickup_label,
                ST_X(d.pickup_location::geometry) AS pickup_longitude, ST_Y(d.pickup_location::geometry) AS pickup_latitude,
                d.dropoff_label, ST_X(d.dropoff_location::geometry) AS dropoff_longitude, ST_Y(d.dropoff_location::geometry) AS dropoff_latitude,
                d.recipient_display_name, d.parcel_description, d.declared_weight_grams, d.created_at,
                a.id AS assignment_id, a.status AS assignment_status, ws.work_state
         FROM delivery.deliveries d
         JOIN delivery.assignments a ON a.delivery_id = d.id
         JOIN dispatch.driver_work_states ws ON ws.driver_user_id = a.driver_user_id
         WHERE d.id = $1 AND a.driver_user_id = $2
         FOR UPDATE OF d, a, ws`,
        [input.deliveryId, input.driverUserId],
      );
      const row = assigned.rows[0];
      if (!row) {
        const exists = await executor.query<{ id: string }>(
          'SELECT id FROM delivery.deliveries WHERE id = $1',
          [input.deliveryId],
        );
        throw new DeliveryCommandError(
          exists.rows[0]
            ? 'DELIVERY_NOT_ASSIGNED_TO_DRIVER'
            : 'DELIVERY_NOT_FOUND',
        );
      }
      const policy = deliveryTransitionPolicy(input.action);
      if (
        row.assignment_status !== 'ACTIVE' ||
        row.state !== policy.fromState ||
        row.work_state !== policy.workStateFrom
      )
        throw new DeliveryCommandError('DELIVERY_INVALID_STATE');
      const nextVersion = row.version + 1;
      const deliveryUpdate = await executor.query(
        `UPDATE delivery.deliveries SET state = $2, version = $3, updated_at = now()
         WHERE id = $1 AND state = $4 AND version = $5`,
        [row.id, policy.toState, nextVersion, policy.fromState, row.version],
      );
      if (deliveryUpdate.rowCount !== 1)
        throw new DeliveryCommandError('DELIVERY_INVALID_STATE');
      if (input.action === 'CONFIRM_PICKUP_CUSTODY') {
        await executor.query(
          `UPDATE delivery.assignments SET pickup_custody_confirmation = $2, pickup_confirmed_at = now()
           WHERE id = $1 AND status = 'ACTIVE' AND pickup_custody_confirmation IS NULL`,
          [row.assignment_id, input.confirmation],
        );
      }
      if (input.action === 'COMPLETE_DELIVERY') {
        await executor.query(
          `INSERT INTO delivery.delivery_proofs (id, delivery_id, assignment_id, recorded_by_user_id, confirmation_text)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            randomUUID(),
            row.id,
            row.assignment_id,
            input.driverUserId,
            input.confirmation,
          ],
        );
        await executor.query(
          `UPDATE delivery.assignments SET status = 'COMPLETED', completed_at = now() WHERE id = $1 AND status = 'ACTIVE'`,
          [row.assignment_id],
        );
      }
      const work = await executor.query(
        `UPDATE dispatch.driver_work_states SET work_state = $2, current_delivery_id = $3,
            state_version = state_version + 1, state_changed_at = now(), updated_at = now()
         WHERE driver_user_id = $1 AND work_state = $4 AND current_delivery_id = $5 AND current_trip_id IS NULL`,
        [
          input.driverUserId,
          policy.workStateTo,
          input.action === 'COMPLETE_DELIVERY' ? null : row.id,
          policy.workStateFrom,
          row.id,
        ],
      );
      if (work.rowCount !== 1)
        throw new DeliveryCommandError('DRIVER_WORK_STATE_CONFLICT');
      await appendTransition(
        executor,
        row.id,
        input.driverUserId,
        input.action,
        policy.fromState,
        policy.toState,
        row.version,
        nextVersion,
        input.correlationId,
      );
      await executor.query(
        `INSERT INTO delivery.outbox_events (id, delivery_id, aggregate_version, event_type, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          row.id,
          nextVersion,
          policy.eventType,
          JSON.stringify({
            deliveryId: row.id,
            driverUserId: input.driverUserId,
            state: policy.toState,
            version: nextVersion,
          }),
        ],
      );
      const response = toDeliveryResponse({
        ...row,
        state: policy.toState,
        version: nextVersion,
      });
      await executor.query(
        `INSERT INTO delivery.command_receipts (actor_user_id, operation, idempotency_key, request_fingerprint, response_body, delivery_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.driverUserId,
          operation,
          input.idempotencyKey,
          input.requestFingerprint,
          JSON.stringify(response),
          row.id,
        ],
      );
      return response;
    });
  }

  async expireDueOffers(): Promise<number> {
    const due = await this.database.query<{ id: string }>(
      `SELECT id FROM delivery.delivery_offers WHERE status = 'PENDING' AND expires_at <= now() ORDER BY expires_at LIMIT 50`,
    );
    let expired = 0;
    for (const candidate of due.rows) {
      const didExpire = await this.database.transaction(async (executor) => {
        const found = await executor.query<OfferRow>(
          `SELECT o.id, o.delivery_id, o.driver_user_id, o.attempt_number, o.status, o.expires_at,
                  d.state AS delivery_state, d.version AS delivery_version, o.acceptance_idempotency_key
           FROM delivery.delivery_offers o JOIN delivery.deliveries d ON d.id = o.delivery_id
           WHERE o.id = $1 FOR UPDATE OF o, d SKIP LOCKED`,
          [candidate.id],
        );
        const offer = found.rows[0];
        if (
          !offer ||
          offer.status !== 'PENDING' ||
          offer.expires_at.getTime() > Date.now()
        )
          return false;
        await expireDeliveryOffer(executor, offer);
        if (offer.delivery_state === 'MATCHING') {
          const nextVersion = offer.delivery_version + 1;
          await executor.query(
            `UPDATE delivery.deliveries SET state = 'NO_DRIVER_AVAILABLE', version = $2, updated_at = now() WHERE id = $1 AND state = 'MATCHING' AND version = $3`,
            [offer.delivery_id, nextVersion, offer.delivery_version],
          );
          await appendTransition(
            executor,
            offer.delivery_id,
            null,
            'EXPIRE_DELIVERY_OFFER',
            'MATCHING',
            'NO_DRIVER_AVAILABLE',
            offer.delivery_version,
            nextVersion,
            randomUUID(),
          );
          await appendDeliveryOutboxEvent(
            executor,
            offer.delivery_id,
            nextVersion,
            'delivery.no_driver_available',
            {
              deliveryId: offer.delivery_id,
              state: 'NO_DRIVER_AVAILABLE',
              version: nextVersion,
            },
          );
        }
        return true;
      });
      if (didExpire) expired += 1;
    }
    return expired;
  }
}

export class DeliveryCommandError extends Error {
  constructor(
    readonly code:
      | 'IDEMPOTENCY_KEY_REUSED'
      | 'DELIVERY_NOT_FOUND'
      | 'DELIVERY_NOT_MATCHABLE'
      | 'OFFER_NOT_FOUND'
      | 'OFFER_NOT_FOR_DRIVER'
      | 'OFFER_ALREADY_RESOLVED'
      | 'OFFER_EXPIRED'
      | 'DRIVER_WORK_STATE_CONFLICT'
      | 'DELIVERY_NOT_ASSIGNED_TO_DRIVER'
      | 'DELIVERY_INVALID_STATE',
  ) {
    super(code);
  }
}

interface OfferRow extends QueryResultRow {
  id: string;
  delivery_id: string;
  driver_user_id: string;
  attempt_number: number;
  status: DeliveryOfferResponse['status'];
  expires_at: Date;
  delivery_state: DeliveryResponse['state'];
  delivery_version: number;
  acceptance_idempotency_key: string | null;
}

interface AssignedDeliveryRow extends DeliveryDetailRow {
  assignment_id: string;
  assignment_status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  work_state: 'TO_PICKUP' | 'ON_TRIP' | 'AVAILABLE';
}

function toDeliveryResponse(row: DeliveryDetailRow): DeliveryResponse {
  return {
    id: row.id,
    state: row.state,
    version: row.version,
    pickup: {
      label: row.pickup_label,
      latitude: finiteNumber(row.pickup_latitude),
      longitude: finiteNumber(row.pickup_longitude),
    },
    dropoff: {
      label: row.dropoff_label,
      latitude: finiteNumber(row.dropoff_latitude),
      longitude: finiteNumber(row.dropoff_longitude),
    },
    recipientDisplayName: row.recipient_display_name,
    parcelDescription: row.parcel_description,
    declaredWeightGrams: row.declared_weight_grams,
    createdAt: row.created_at.toISOString(),
  };
}

function deliveryTransitionPolicy(
  action: 'ARRIVE_AT_PICKUP' | 'CONFIRM_PICKUP_CUSTODY' | 'COMPLETE_DELIVERY',
): {
  fromState: DeliveryResponse['state'];
  toState: DeliveryResponse['state'];
  workStateFrom: 'TO_PICKUP' | 'ON_TRIP';
  workStateTo: 'TO_PICKUP' | 'ON_TRIP' | 'AVAILABLE';
  eventType: string;
} {
  if (action === 'ARRIVE_AT_PICKUP')
    return {
      fromState: 'DRIVER_TO_PICKUP',
      toState: 'AT_PICKUP',
      workStateFrom: 'TO_PICKUP',
      workStateTo: 'TO_PICKUP',
      eventType: 'delivery.driver.arrived_at_pickup',
    };
  if (action === 'CONFIRM_PICKUP_CUSTODY')
    return {
      fromState: 'AT_PICKUP',
      toState: 'IN_TRANSIT',
      workStateFrom: 'TO_PICKUP',
      workStateTo: 'ON_TRIP',
      eventType: 'delivery.pickup.custody_confirmed',
    };
  return {
    fromState: 'IN_TRANSIT',
    toState: 'DELIVERED',
    workStateFrom: 'ON_TRIP',
    workStateTo: 'AVAILABLE',
    eventType: 'delivery.completed',
  };
}

async function reserveOffer(
  executor: import('../database/database.service.js').DatabaseExecutor,
  deliveryId: string,
  deliveryVersion: number,
): Promise<DeliveryOfferResponse | null> {
  const candidates = await executor.query<{ driver_user_id: string }>(
    `SELECT ws.driver_user_id FROM delivery.deliveries d
     JOIN location.latest_driver_locations loc ON true
     JOIN dispatch.driver_work_states ws ON ws.driver_user_id = loc.driver_user_id
     JOIN driver.driver_profiles p ON p.user_id = ws.driver_user_id
     JOIN driver.vehicles v ON v.driver_user_id = ws.driver_user_id
     WHERE d.id = $1 AND ws.work_state = 'AVAILABLE' AND p.approval_status = 'APPROVED' AND p.deactivated_at IS NULL
       AND v.approval_status = 'APPROVED' AND v.is_selected = true
       AND loc.received_at >= now() - INTERVAL '30 seconds'
       AND ST_DWithin(loc.location, d.pickup_location, 5000)
     ORDER BY ST_Distance(loc.location, d.pickup_location), ws.driver_user_id LIMIT 8 FOR UPDATE OF ws SKIP LOCKED`,
    [deliveryId],
  );
  for (const candidate of candidates.rows) {
    const reservationId = randomUUID();
    const reservation = await executor.query<{ expires_at: Date }>(
      `INSERT INTO delivery.driver_reservations (id, driver_user_id, delivery_id, expires_at) VALUES ($1, $2, $3, now() + INTERVAL '20 seconds') ON CONFLICT DO NOTHING RETURNING expires_at`,
      [reservationId, candidate.driver_user_id, deliveryId],
    );
    if (!reservation.rows[0]) continue;
    const state = await executor.query(
      `UPDATE dispatch.driver_work_states SET work_state = 'RESERVED', current_delivery_id = $2, state_version = state_version + 1, state_changed_at = now(), updated_at = now() WHERE driver_user_id = $1 AND work_state = 'AVAILABLE' AND current_trip_id IS NULL AND current_delivery_id IS NULL`,
      [candidate.driver_user_id, deliveryId],
    );
    if (state.rowCount !== 1) {
      await executor.query(
        `UPDATE delivery.driver_reservations SET status = 'RELEASED', resolved_at = now(), resolution_reason = 'WORK_STATE_CHANGED' WHERE id = $1`,
        [reservationId],
      );
      continue;
    }
    const offerId = randomUUID();
    const offer = await executor.query<OfferRow>(
      `INSERT INTO delivery.delivery_offers (id, delivery_id, reservation_id, driver_user_id, attempt_number, expires_at) VALUES ($1, $2, $3, $4, 1, $5) RETURNING id, delivery_id, driver_user_id, attempt_number, status, expires_at, 'MATCHING'::text AS delivery_state, $6::integer AS delivery_version, acceptance_idempotency_key`,
      [
        offerId,
        deliveryId,
        reservationId,
        candidate.driver_user_id,
        reservation.rows[0].expires_at,
        deliveryVersion,
      ],
    );
    return toOfferResponse(offer.rows[0] as OfferRow);
  }
  return null;
}

async function appendTransition(
  executor: import('../database/database.service.js').DatabaseExecutor,
  deliveryId: string,
  actorUserId: string | null,
  command: string,
  fromState: string | null,
  toState: string,
  fromVersion: number | null,
  toVersion: number,
  correlationId: string,
): Promise<void> {
  await executor.query(
    `INSERT INTO delivery.state_transitions (id, delivery_id, actor_user_id, command, from_state, to_state, from_version, to_version, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      deliveryId,
      actorUserId,
      command,
      fromState,
      toState,
      fromVersion,
      toVersion,
      correlationId,
    ],
  );
}

async function appendDeliveryOutboxEvent(
  executor: import('../database/database.service.js').DatabaseExecutor,
  deliveryId: string,
  aggregateVersion: number,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await executor.query(
    `INSERT INTO delivery.outbox_events (
       id, delivery_id, aggregate_version, event_type, payload
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      randomUUID(),
      deliveryId,
      aggregateVersion,
      eventType,
      JSON.stringify(payload),
    ],
  );
}

async function expireDeliveryOffer(
  executor: import('../database/database.service.js').DatabaseExecutor,
  offer: OfferRow,
): Promise<void> {
  await executor.query(
    `UPDATE delivery.delivery_offers SET status = 'EXPIRED', resolved_at = now(), resolution_reason = 'OFFER_EXPIRED' WHERE id = $1 AND status = 'PENDING'`,
    [offer.id],
  );
  await executor.query(
    `UPDATE delivery.driver_reservations SET status = 'EXPIRED', resolved_at = now(), resolution_reason = 'OFFER_EXPIRED' WHERE delivery_id = $1 AND driver_user_id = $2 AND status = 'ACTIVE'`,
    [offer.delivery_id, offer.driver_user_id],
  );
  await executor.query(
    `UPDATE dispatch.driver_work_states SET work_state = 'AVAILABLE', current_delivery_id = NULL, state_version = state_version + 1, state_changed_at = now(), updated_at = now() WHERE driver_user_id = $1 AND work_state = 'RESERVED' AND current_delivery_id = $2`,
    [offer.driver_user_id, offer.delivery_id],
  );
}

function toOfferResponse(row: OfferRow): DeliveryOfferResponse {
  return {
    id: row.id,
    deliveryId: row.delivery_id,
    driverId: row.driver_user_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    deliveryState: row.delivery_state,
    deliveryVersion: row.delivery_version,
  };
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

function finiteNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error('Delivery coordinate is not finite');
  return parsed;
}
