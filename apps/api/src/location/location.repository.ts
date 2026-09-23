import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { DatabaseService } from '../database/database.service.js';
import type { LatestLocationInput } from './location.schemas.js';

export interface LatestLocationRow extends QueryResultRow {
  driver_user_id: string;
  captured_at: Date;
  received_at: Date;
  sequence_number: string;
}

@Injectable()
export class LocationRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async upsertLatest(
    driverUserId: string,
    input: LatestLocationInput,
  ): Promise<LatestLocationRow> {
    const result = await this.database.query<LatestLocationRow>(
      `INSERT INTO location.latest_driver_locations (
         driver_user_id, location, accuracy_meters, speed_meters_per_second,
         heading_degrees, captured_at, source, sequence_number
       ) VALUES (
         $1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
         $4, $5, $6, $7, $8, $9
       )
       ON CONFLICT (driver_user_id) DO UPDATE SET
         location = EXCLUDED.location,
         accuracy_meters = EXCLUDED.accuracy_meters,
         speed_meters_per_second = EXCLUDED.speed_meters_per_second,
         heading_degrees = EXCLUDED.heading_degrees,
         captured_at = EXCLUDED.captured_at,
         received_at = now(),
         source = EXCLUDED.source,
         sequence_number = EXCLUDED.sequence_number
       WHERE EXCLUDED.sequence_number > location.latest_driver_locations.sequence_number
          OR (
            EXCLUDED.sequence_number = location.latest_driver_locations.sequence_number
            AND EXCLUDED.captured_at > location.latest_driver_locations.captured_at
          )
       RETURNING driver_user_id, captured_at, received_at, sequence_number`,
      [
        driverUserId,
        input.longitude,
        input.latitude,
        input.accuracyMeters,
        input.speedMetersPerSecond ?? null,
        input.headingDegrees ?? null,
        input.capturedAt ? new Date(input.capturedAt) : new Date(),
        input.source,
        input.sequenceNumber,
      ],
    );

    if (result.rows[0]) return result.rows[0];

    const current = await this.database.query<LatestLocationRow>(
      `SELECT driver_user_id, captured_at, received_at, sequence_number
       FROM location.latest_driver_locations
       WHERE driver_user_id = $1`,
      [driverUserId],
    );
    return current.rows[0] as LatestLocationRow;
  }
}
