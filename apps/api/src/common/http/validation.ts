import { HttpStatus } from '@nestjs/common';
import type { z } from 'zod';

import { ApiError } from './api-error.js';

export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  throw new ApiError(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_FAILED',
    'The request contains invalid fields.',
    parsed.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'request',
      reason: issue.code,
    })),
  );
}
