import { z } from 'zod';

export const paymentTripParamsSchema = z.object({
  tripId: z.uuid(),
});

export const capturePaymentSchema = z.object({
  simulationOutcome: z
    .enum(['PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'])
    .default('SUCCEEDED'),
});

export type CapturePaymentInput = z.output<typeof capturePaymentSchema>;
