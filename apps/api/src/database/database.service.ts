import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';

import { readAppConfig } from '../config/app-config.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: readAppConfig().DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    max: 10,
  });

  query<Result extends QueryResultRow>(text: string) {
    return this.pool.query<Result>(text);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
