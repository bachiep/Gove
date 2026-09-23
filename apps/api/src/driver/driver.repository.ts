import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { DatabaseService } from '../database/database.service.js';

export type VehicleClass = 'MOTORBIKE' | 'STANDARD_CAR' | 'PREMIUM_CAR' | 'VAN';

export interface DriverProfile extends QueryResultRow {
  user_id: string;
  phone: string | null;
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  review_reason: string | null;
  deactivated_at: Date | null;
}

export interface Vehicle extends QueryResultRow {
  id: string;
  driver_user_id: string;
  vehicle_class: VehicleClass;
  make: string;
  model: string;
  model_year: number;
  plate_normalized: string;
  approval_status:
    'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'RETIRED';
  is_selected: boolean;
  retired_at: Date | null;
}

@Injectable()
export class DriverRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async getProfile(userId: string): Promise<DriverProfile | null> {
    const result = await this.database.query<DriverProfile>(
      `SELECT user_id, phone, approval_status, review_reason, deactivated_at
       FROM driver.driver_profiles WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async updateProfile(
    userId: string,
    phone: string | null,
  ): Promise<DriverProfile | null> {
    const result = await this.database.query<DriverProfile>(
      `UPDATE driver.driver_profiles
       SET phone = $2
       WHERE user_id = $1 AND deactivated_at IS NULL
       RETURNING user_id, phone, approval_status, review_reason, deactivated_at`,
      [userId, phone],
    );
    return result.rows[0] ?? null;
  }

  async createVehicle(input: {
    userId: string;
    vehicleClass: VehicleClass;
    make: string;
    model: string;
    modelYear: number;
    plateNormalized: string;
  }): Promise<Vehicle> {
    const result = await this.database.query<Vehicle>(
      `INSERT INTO driver.vehicles
        (id, driver_user_id, vehicle_class, make, model, model_year, plate_normalized)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, driver_user_id, vehicle_class, make, model, model_year,
                 plate_normalized, approval_status, is_selected, retired_at`,
      [
        randomUUID(),
        input.userId,
        input.vehicleClass,
        input.make,
        input.model,
        input.modelYear,
        input.plateNormalized,
      ],
    );
    return result.rows[0] as Vehicle;
  }

  async listVehicles(userId: string): Promise<Vehicle[]> {
    const result = await this.database.query<Vehicle>(
      `SELECT id, driver_user_id, vehicle_class, make, model, model_year,
              plate_normalized, approval_status, is_selected, retired_at
       FROM driver.vehicles
       WHERE driver_user_id = $1 AND approval_status <> 'RETIRED'
       ORDER BY created_at`,
      [userId],
    );
    return result.rows;
  }

  async retireVehicle(userId: string, vehicleId: string): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE driver.vehicles
       SET approval_status = 'RETIRED', retired_at = now(), is_selected = false
       WHERE id = $1 AND driver_user_id = $2 AND approval_status <> 'RETIRED'`,
      [vehicleId, userId],
    );
    return result.rowCount === 1;
  }

  async isEligible(
    userId: string,
  ): Promise<{ eligible: boolean; reason: string }> {
    const profile = await this.getProfile(userId);
    if (!profile || profile.deactivated_at) {
      return { eligible: false, reason: 'PROFILE_INCOMPLETE' };
    }
    if (profile.approval_status !== 'APPROVED') {
      return { eligible: false, reason: 'PROFILE_PENDING_REVIEW' };
    }
    const vehicle = await this.database.query<{ id: string }>(
      `SELECT id FROM driver.vehicles
       WHERE driver_user_id = $1
         AND approval_status = 'APPROVED'
         AND is_selected = true
       LIMIT 1`,
      [userId],
    );
    return vehicle.rowCount
      ? { eligible: true, reason: 'ELIGIBLE' }
      : { eligible: false, reason: 'NO_APPROVED_VEHICLE' };
  }
}
