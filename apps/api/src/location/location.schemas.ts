import { z } from 'zod';

export const latestLocationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(0).max(10_000),
  speedMetersPerSecond: z
    .number()
    .finite()
    .min(0)
    .max(100)
    .nullable()
    .optional(),
  headingDegrees: z.number().finite().min(0).max(359.999).nullable().optional(),
  capturedAt: z.iso.datetime().optional(),
  source: z.enum(['GPS', 'NETWORK', 'SIMULATOR']).default('GPS'),
  sequenceNumber: z.number().int().min(0).default(0),
});

export type LatestLocationInput = z.output<typeof latestLocationSchema>;
