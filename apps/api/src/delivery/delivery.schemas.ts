import { z } from 'zod';

const locationSchema = z.object({
  label: z.string().trim().min(1).max(160),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export const createDeliverySchema = z
  .object({
    pickup: locationSchema,
    dropoff: locationSchema,
    recipient: z.object({
      displayName: z.string().trim().min(1).max(120),
      contactPhone: z
        .string()
        .trim()
        .regex(/^\+?[0-9][0-9 -]{5,30}$/),
    }),
    parcel: z.object({
      description: z.string().trim().min(1).max(280),
      declaredWeightGrams: z.number().int().min(1).max(30_000),
    }),
  })
  .refine(
    (value) =>
      value.pickup.latitude !== value.dropoff.latitude ||
      value.pickup.longitude !== value.dropoff.longitude,
    { message: 'Pickup and Dropoff must differ.', path: ['dropoff'] },
  );

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;

export const deliveryParamsSchema = z.object({ deliveryId: z.uuid() });
export const deliveryOfferParamsSchema = z.object({ offerId: z.uuid() });
