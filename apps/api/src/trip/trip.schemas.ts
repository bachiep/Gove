import { z } from 'zod';

export const createTripSchema = z.object({
  fareQuoteId: z.uuid(),
});
