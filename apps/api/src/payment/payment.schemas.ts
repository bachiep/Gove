import { z } from 'zod';

import { paymentProviders, paymentStatuses } from '@gove/contracts';

export const paymentTripParamsSchema = z.object({
  tripId: z.uuid(),
});

export const capturePaymentSchema = z
  .object({
    provider: z.enum(paymentProviders).default('SIMULATOR'),
    simulationOutcome: z.enum(paymentStatuses).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.provider !== 'SIMULATOR' &&
      value.simulationOutcome !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['simulationOutcome'],
        message: 'simulationOutcome is only available for the simulator.',
      });
    }
  });

export type CapturePaymentInput = z.output<typeof capturePaymentSchema>;
