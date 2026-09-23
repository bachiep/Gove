import { z } from 'zod';

const localJwtSecret =
  'gove-local-development-jwt-secret-change-before-production';
const localRefreshPepper =
  'gove-local-development-refresh-pepper-change-before-production';

const environmentSchema = z.object({
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z
    .url()
    .default('postgresql://gove:gove_local_only@127.0.0.1:55432/gove'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  AUTH_ACCESS_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3_600)
    .default(600),
  AUTH_ISSUER: z.string().min(1).default('gove-api'),
  AUTH_AUDIENCE: z.string().min(1).default('gove-pwa'),
  AUTH_JWT_SECRET: z.string().min(32).default(localJwtSecret),
  AUTH_REFRESH_PEPPER: z.string().min(32).default(localRefreshPepper),
  AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3_600)
    .default(60),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function readAppConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const config = environmentSchema.parse(environment);

  if (
    config.NODE_ENV === 'production' &&
    (config.AUTH_JWT_SECRET === localJwtSecret ||
      config.AUTH_REFRESH_PEPPER === localRefreshPepper)
  ) {
    throw new Error('Production authentication secrets must be configured');
  }

  return config;
}
