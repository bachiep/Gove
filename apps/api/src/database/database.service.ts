import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { readAppConfig } from '../config/app-config.js';

export interface DatabaseExecutor {
  query<Result extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Result[]; rowCount: number | null }>;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: readAppConfig().DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    max: 10,
  });

  query<Result extends QueryResultRow>(text: string, values?: unknown[]) {
    return values
      ? this.pool.query<Result>(text, values)
      : this.pool.query<Result>(text);
  }

  async transaction<Result>(
    work: (executor: DatabaseExecutor) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PoolClientExecutor(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

class PoolClientExecutor implements DatabaseExecutor {
  constructor(private readonly client: PoolClient) {}

  query<Result extends QueryResultRow>(text: string, values?: unknown[]) {
    return values
      ? this.client.query<Result>(text, values)
      : this.client.query<Result>(text);
  }
}
