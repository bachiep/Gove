import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { DeliveryResponse } from '@gove/contracts';
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
}

export class DeliveryCommandError extends Error {
  constructor(readonly code: 'IDEMPOTENCY_KEY_REUSED') {
    super(code);
  }
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
