import { z } from 'zod';

export const driverProfileSchema = z.object({
  phone: z.string().trim().min(7).max(32).optional(),
});

export const createVehicleSchema = z.object({
  vehicleClass: z.enum(['MOTORBIKE', 'STANDARD_CAR', 'PREMIUM_CAR', 'VAN']),
  make: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  modelYear: z.coerce.number().int().min(1900).max(2100),
  plate: z.string().trim().min(3).max(30),
});

export const updateVehicleSchema = createVehicleSchema.partial();
