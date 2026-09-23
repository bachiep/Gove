import { z } from 'zod';

const locationSchema = z.object({
  label: z.string().trim().min(1).max(160),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export const createFareQuoteSchema = z
  .object({
    pickup: locationSchema,
    dropoff: locationSchema,
    serviceType: z.enum(['MOTORBIKE_STANDARD', 'CAR_STANDARD']),
  })
  .refine(
    (input) =>
      input.pickup.latitude !== input.dropoff.latitude ||
      input.pickup.longitude !== input.dropoff.longitude,
    { message: 'Pickup and dropoff must differ.', path: ['dropoff'] },
  );
