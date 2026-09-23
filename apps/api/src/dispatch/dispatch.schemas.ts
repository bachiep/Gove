import { z } from 'zod';

export const driverWorkStateSchema = z.object({
  state: z.enum(['AVAILABLE', 'OFFLINE']),
});

export const dispatchTripParamsSchema = z.object({
  tripId: z.uuid(),
});

export const dispatchOfferParamsSchema = z.object({
  offerId: z.uuid(),
});

export const completeTripSchema = z.object({
  actualDistanceMeters: z.number().int().positive().max(1_000_000),
  actualDurationSeconds: z.number().int().positive().max(86_400),
});

export type DriverWorkStateInput = z.output<typeof driverWorkStateSchema>;
