import { describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../database/database.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports process liveness without querying dependencies', () => {
    const query = vi.fn();
    const controller = new HealthController({ query } as never);

    expect(controller.live()).toMatchObject({
      service: 'gove-api',
      status: 'ok',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports the actual PostGIS version when ready', async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [{ version: '3.5.2' }] }),
    } as unknown as DatabaseService;
    const controller = new HealthController(database);

    await expect(controller.ready()).resolves.toMatchObject({
      dependencies: { postgres: 'ready', postgis: '3.5.2' },
    });
  });
});
