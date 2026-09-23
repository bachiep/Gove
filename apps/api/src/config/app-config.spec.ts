import { describe, expect, it } from 'vitest';

import { readAppConfig } from './app-config.js';

describe('readAppConfig', () => {
  it('rejects a port outside the TCP range', () => {
    expect(() => readAppConfig({ API_PORT: '70000' })).toThrow();
  });

  it('provides safe local defaults', () => {
    const config = readAppConfig({});

    expect(config.API_HOST).toBe('127.0.0.1');
    expect(config.DATABASE_URL).toContain('@127.0.0.1:55432/gove');
  });

  it('rejects the local authentication secrets in production', () => {
    expect(() => readAppConfig({ NODE_ENV: 'production' })).toThrow(
      'Production authentication secrets',
    );
  });
});
