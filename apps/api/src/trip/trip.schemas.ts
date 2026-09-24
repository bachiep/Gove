import { z } from 'zod';
import { cancellationReasonCodes } from '@gove/contracts';

export const createTripSchema = z.object({
  fareQuoteId: z.uuid(),
});

export const tripParamsSchema = z.object({
  tripId: z.uuid(),
});

export const cancelTripSchema = z
  .object({
    reasonCode: z.enum(cancellationReasonCodes),
    reasonDetail: z.string().trim().min(3).max(240).optional(),
  })
  .superRefine(({ reasonCode, reasonDetail }, context) => {
    if (reasonCode === 'OTHER' && !reasonDetail) {
      context.addIssue({
        code: 'custom',
        path: ['reasonDetail'],
        message: 'reasonDetail is required when reasonCode is OTHER.',
      });
    }
  });

export type CancelTripInput = z.output<typeof cancelTripSchema>;
