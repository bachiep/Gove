import { Inject, Injectable } from '@nestjs/common';
import type {
  DeliveryRealtimeSnapshot,
  DeliveryState,
  TripRealtimeSnapshot,
  TripState,
} from '@gove/contracts';
import type { QueryResultRow } from 'pg';

import { DatabaseService } from '../database/database.service.js';

interface TripSnapshotRow extends QueryResultRow {
  id: string;
  fare_quote_id: string;
  service_type_code: TripRealtimeSnapshot['serviceType'];
  state: TripState;
  version: number;
  currency: string;
  quoted_total_fare_minor: string;
  actual_distance_meters: number | null;
  actual_duration_seconds: number | null;
  final_fare_minor: string | null;
  created_at: Date;
  completed_at: Date | null;
  driver_id: string | null;
  driver_latitude: number | null;
  driver_longitude: number | null;
  driver_accuracy_meters: number | null;
  driver_captured_at: Date | null;
  driver_received_at: Date | null;
}

interface OutboxEventRow extends QueryResultRow {
  id: string;
  trip_id: string;
  aggregate_version: number;
  event_type: string;
  payload: unknown;
  occurred_at: Date;
}

interface DeliverySnapshotRow extends QueryResultRow {
  id: string;
  state: DeliveryState;
  version: number;
  pickup_label: string;
  pickup_latitude: number;
  pickup_longitude: number;
  dropoff_label: string;
  dropoff_latitude: number;
  dropoff_longitude: number;
  recipient_display_name: string;
  parcel_description: string;
  declared_weight_grams: number;
  created_at: Date;
  driver_id: string | null;
  driver_latitude: number | null;
  driver_longitude: number | null;
  driver_accuracy_meters: number | null;
  driver_captured_at: Date | null;
  driver_received_at: Date | null;
}

interface DeliveryOutboxEventRow extends QueryResultRow {
  id: string;
  delivery_id: string;
  aggregate_version: number;
  event_type: string;
  payload: unknown;
  occurred_at: Date;
}

export interface OutboxCursor {
  occurredAt: Date;
  id: string;
}

@Injectable()
export class RealtimeRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async findAuthorizedTripSnapshot(
    actorId: string,
    tripId: string,
  ): Promise<TripRealtimeSnapshot | null> {
    const result = await this.database.query<TripSnapshotRow>(
      `SELECT t.id, t.fare_quote_id, t.service_type_code, t.state, t.version,
              t.currency, t.quoted_total_fare_minor,
              t.actual_distance_meters, t.actual_duration_seconds,
              t.final_fare_minor, t.completed_at, t.created_at,
              assignment.driver_user_id AS driver_id,
              ST_Y(loc.location::geometry)::double precision AS driver_latitude,
              ST_X(loc.location::geometry)::double precision AS driver_longitude,
              loc.accuracy_meters AS driver_accuracy_meters,
              loc.captured_at AS driver_captured_at,
              loc.received_at AS driver_received_at
       FROM trip.trips t
       LEFT JOIN dispatch.assignments assignment
         ON assignment.trip_id = t.id
        AND assignment.status = 'ACTIVE'
       LEFT JOIN location.latest_driver_locations loc
         ON loc.driver_user_id = assignment.driver_user_id
        AND loc.received_at >= now() - interval '15 seconds'
       WHERE t.id = $1
         AND (
           t.customer_user_id = $2
           OR (assignment.driver_user_id = $2 AND assignment.status = 'ACTIVE')
           OR EXISTS (
             SELECT 1
             FROM dispatch.trip_offers o
             WHERE o.trip_id = t.id
               AND o.driver_user_id = $2
               AND o.status = 'PENDING'
           )
         )`,
      [tripId, actorId],
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
      quotedTotalFareMinor: Number(row.quoted_total_fare_minor),
      createdAt: row.created_at.toISOString(),
      driverId: row.driver_id,
      actualDistanceMeters: row.actual_distance_meters,
      actualDurationSeconds: row.actual_duration_seconds,
      finalFareMinor:
        row.final_fare_minor === null ? null : Number(row.final_fare_minor),
      completedAt: row.completed_at?.toISOString() ?? null,
      driverLocation:
        row.driver_id &&
        row.driver_latitude !== null &&
        row.driver_longitude !== null &&
        row.driver_accuracy_meters !== null &&
        row.driver_captured_at &&
        row.driver_received_at
          ? {
              latitude: row.driver_latitude,
              longitude: row.driver_longitude,
              accuracyMeters: Number(row.driver_accuracy_meters),
              capturedAt: row.driver_captured_at.toISOString(),
              receivedAt: row.driver_received_at.toISOString(),
            }
          : null,
    };
  }

  async findCurrentTripIdsForDriver(driverId: string): Promise<string[]> {
    const result = await this.database.query<{ trip_id: string }>(
      `SELECT assignment.trip_id
       FROM dispatch.assignments assignment
       JOIN trip.trips trip ON trip.id = assignment.trip_id
       WHERE assignment.driver_user_id = $1
         AND assignment.status = 'ACTIVE'
         AND trip.state IN ('DRIVER_TO_PICKUP', 'AT_PICKUP', 'IN_PROGRESS')`,
      [driverId],
    );
    return result.rows.map((row) => row.trip_id);
  }

  async findAuthorizedDeliverySnapshot(
    actorId: string,
    deliveryId: string,
  ): Promise<DeliveryRealtimeSnapshot | null> {
    const result = await this.database.query<DeliverySnapshotRow>(
      `SELECT d.id, d.state, d.version, d.pickup_label,
              ST_X(d.pickup_location::geometry)::double precision AS pickup_longitude,
              ST_Y(d.pickup_location::geometry)::double precision AS pickup_latitude,
              d.dropoff_label,
              ST_X(d.dropoff_location::geometry)::double precision AS dropoff_longitude,
              ST_Y(d.dropoff_location::geometry)::double precision AS dropoff_latitude,
              d.recipient_display_name, d.parcel_description, d.declared_weight_grams,
              d.created_at, assignment.driver_user_id AS driver_id,
              ST_Y(loc.location::geometry)::double precision AS driver_latitude,
              ST_X(loc.location::geometry)::double precision AS driver_longitude,
              loc.accuracy_meters AS driver_accuracy_meters,
              loc.captured_at AS driver_captured_at,
              loc.received_at AS driver_received_at
       FROM delivery.deliveries d
       LEFT JOIN delivery.assignments assignment
         ON assignment.delivery_id = d.id
        AND assignment.status = 'ACTIVE'
       LEFT JOIN location.latest_driver_locations loc
         ON loc.driver_user_id = assignment.driver_user_id
        AND loc.received_at >= now() - interval '15 seconds'
       WHERE d.id = $1
         AND (
           d.customer_user_id = $2
           OR (assignment.driver_user_id = $2 AND assignment.status = 'ACTIVE')
           OR EXISTS (
             SELECT 1
             FROM delivery.delivery_offers o
             WHERE o.delivery_id = d.id
               AND o.driver_user_id = $2
               AND o.status = 'PENDING'
           )
         )
       ORDER BY assignment.accepted_at DESC NULLS LAST
       LIMIT 1`,
      [deliveryId, actorId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      state: row.state,
      version: row.version,
      pickup: {
        label: row.pickup_label,
        latitude: Number(row.pickup_latitude),
        longitude: Number(row.pickup_longitude),
      },
      dropoff: {
        label: row.dropoff_label,
        latitude: Number(row.dropoff_latitude),
        longitude: Number(row.dropoff_longitude),
      },
      recipientDisplayName: row.recipient_display_name,
      parcelDescription: row.parcel_description,
      declaredWeightGrams: row.declared_weight_grams,
      createdAt: row.created_at.toISOString(),
      driverId: row.driver_id,
      driverLocation:
        row.driver_id &&
        row.driver_latitude !== null &&
        row.driver_longitude !== null &&
        row.driver_accuracy_meters !== null &&
        row.driver_captured_at &&
        row.driver_received_at
          ? {
              latitude: row.driver_latitude,
              longitude: row.driver_longitude,
              accuracyMeters: Number(row.driver_accuracy_meters),
              capturedAt: row.driver_captured_at.toISOString(),
              receivedAt: row.driver_received_at.toISOString(),
            }
          : null,
    };
  }

  async findCurrentDeliveryIdsForDriver(driverId: string): Promise<string[]> {
    const result = await this.database.query<{ delivery_id: string }>(
      `SELECT assignment.delivery_id
       FROM delivery.assignments assignment
       JOIN delivery.deliveries delivery ON delivery.id = assignment.delivery_id
       WHERE assignment.driver_user_id = $1
         AND assignment.status = 'ACTIVE'
         AND delivery.state IN ('DRIVER_TO_PICKUP', 'AT_PICKUP', 'IN_TRANSIT')`,
      [driverId],
    );
    return result.rows.map((row) => row.delivery_id);
  }

  async listOutboxAfter(
    cursor: OutboxCursor,
  ): Promise<{ events: OutboxEventRow[]; cursor: OutboxCursor }> {
    const result = await this.database.query<OutboxEventRow>(
      `SELECT id, trip_id, aggregate_version, event_type, payload, occurred_at
       FROM trip.outbox_events
       WHERE (occurred_at, id) > ($1, $2)
       ORDER BY occurred_at ASC, id ASC
       LIMIT 100`,
      [cursor.occurredAt, cursor.id],
    );
    const last = result.rows.at(-1);
    return {
      events: result.rows,
      cursor: last ? { occurredAt: last.occurred_at, id: last.id } : cursor,
    };
  }

  async listDeliveryOutboxAfter(
    cursor: OutboxCursor,
  ): Promise<{ events: DeliveryOutboxEventRow[]; cursor: OutboxCursor }> {
    const result = await this.database.query<DeliveryOutboxEventRow>(
      `SELECT id, delivery_id, aggregate_version, event_type, payload, occurred_at
       FROM delivery.outbox_events
       WHERE (occurred_at, id) > ($1, $2)
       ORDER BY occurred_at ASC, id ASC
       LIMIT 100`,
      [cursor.occurredAt, cursor.id],
    );
    const last = result.rows.at(-1);
    return {
      events: result.rows,
      cursor: last ? { occurredAt: last.occurred_at, id: last.id } : cursor,
    };
  }
}
