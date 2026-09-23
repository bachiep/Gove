import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { readAppConfig } from '../config/app-config.js';
import { loadLocalEnvironment } from '../environment.js';

const migrationsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../infra/postgres/migrations',
);

async function migrate(): Promise<void> {
  loadLocalEnvironment();
  const client = new Client({ connectionString: readAppConfig().DATABASE_URL });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('gove:migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const entries = (await readdir(migrationsDirectory))
      .filter((entry) => /^\d{4}-.+\.sql$/.test(entry))
      .sort();

    for (const entry of entries) {
      const applied = await client.query<{ version: string }>(
        'SELECT version FROM public.schema_migrations WHERE version = $1',
        [entry],
      );
      if (applied.rowCount) continue;

      const sql = await readFile(resolve(migrationsDirectory, entry), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations(version) VALUES ($1)',
          [entry],
        );
        await client.query('COMMIT');
        process.stdout.write(`Applied ${entry}\n`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext('gove:migrations'))",
    );
    await client.end();
  }
}

await migrate();
