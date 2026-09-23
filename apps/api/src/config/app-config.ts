import { z } from 'zod';

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
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function readAppConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return environmentSchema.parse(environment);
}
