import { Inject, Injectable } from '@nestjs/common';
import type { TripRealtimeSnapshot, TripState } from '@gove/contracts';
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
  created_at: Date;
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
              t.currency, t.quoted_total_fare_minor, t.created_at,
              assignment.driver_id,
              ST_Y(loc.location::geometry)::double precision AS driver_latitude,
              ST_X(loc.location::geometry)::double precision AS driver_longitude,
              loc.accuracy_meters AS driver_accuracy_meters,
              loc.captured_at AS driver_captured_at,
              loc.received_at AS driver_received_at
       FROM trip.trips t
       LEFT JOIN LATERAL (
         SELECT ws.driver_user_id AS driver_id
         FROM dispatch.driver_work_states ws
         WHERE ws.current_trip_id = t.id
           AND ws.work_state IN ('RESERVED', 'TO_PICKUP', 'ON_TRIP')
         ORDER BY ws.updated_at DESC
         LIMIT 1
       ) assignment ON true
       LEFT JOIN location.latest_driver_locations loc
         ON loc.driver_user_id = assignment.driver_id
       WHERE t.id = $1
         AND (
           t.customer_user_id = $2
           OR assignment.driver_id = $2
           OR EXISTS (
             SELECT 1
             FROM dispatch.trip_offers o
             WHERE o.trip_id = t.id
               AND o.driver_user_id = $2
               AND o.status IN ('PENDING', 'ACCEPTED')
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
      `SELECT current_trip_id AS trip_id
       FROM dispatch.driver_work_states
       WHERE driver_user_id = $1 AND current_trip_id IS NOT NULL`,
      [driverId],
    );
    return result.rows.map((row) => row.trip_id);
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
}
