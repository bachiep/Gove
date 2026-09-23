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

export type DriverWorkStateInput = z.output<typeof driverWorkStateSchema>;
