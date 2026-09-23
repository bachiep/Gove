import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128),
  requestedRole: z.enum(['CUSTOMER', 'DRIVER']).default('CUSTOMER'),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
});
