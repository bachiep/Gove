import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiError } from '../common/http/api-error.js';
import { DriverRepository, type VehicleClass } from './driver.repository.js';

@Injectable()
export class DriverService {
  constructor(
    @Inject(DriverRepository) private readonly repository: DriverRepository,
  ) {}

  async getProfile(userId: string) {
    const profile = await this.repository.getProfile(userId);
    if (!profile || profile.deactivated_at) throw profileNotFound();
    return profile;
  }

  async updateProfile(userId: string, input: { phone?: string }) {
    const profile = await this.repository.updateProfile(
      userId,
      input.phone ?? null,
    );
    if (!profile) throw profileNotFound();
    return profile;
  }

  async createVehicle(
    userId: string,
    input: {
      vehicleClass: VehicleClass;
      make: string;
      model: string;
      modelYear: number;
      plate: string;
    },
  ) {
    await this.getProfile(userId);
    try {
      return await this.repository.createVehicle({
        ...input,
        userId,
        make: input.make.trim(),
        model: input.model.trim(),
        plateNormalized: normalizePlate(input.plate),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'VEHICLE_PLATE_CONFLICT',
          'A current vehicle already uses this plate.',
        );
      }
      throw error;
    }
  }

  listVehicles(userId: string) {
    return this.repository.listVehicles(userId);
  }

  async retireVehicle(userId: string, vehicleId: string): Promise<void> {
    if (!(await this.repository.retireVehicle(userId, vehicleId))) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'VEHICLE_NOT_FOUND',
        'The vehicle was not found.',
      );
    }
  }

  eligibility(userId: string) {
    return this.repository.isEligible(userId);
  }
}

function normalizePlate(plate: string): string {
  return plate.trim().replaceAll(/\s+/g, '').toUpperCase();
}

function profileNotFound(): ApiError {
  return new ApiError(
    HttpStatus.NOT_FOUND,
    'DRIVER_PROFILE_NOT_FOUND',
    'The driver profile was not found.',
  );
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23505'
  );
}
