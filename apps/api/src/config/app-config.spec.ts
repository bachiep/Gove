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

  it('accepts a safe optional OSRM base URL', () => {
    const config = readAppConfig({
      ROUTING_OSRM_BASE_URL: 'http://127.0.0.1:5000/osrm',
    });

    expect(config.ROUTING_OSRM_BASE_URL).toBe('http://127.0.0.1:5000/osrm');
  });

  it('treats an empty Compose override as the unset fallback mode', () => {
    const config = readAppConfig({ ROUTING_OSRM_BASE_URL: '' });

    expect(config.ROUTING_OSRM_BASE_URL).toBeUndefined();
  });

  it.each([
    'ftp://router.internal',
    'https://user:password@router.internal',
    'https://router.internal?profile=driving',
    'https://router.internal#route',
  ])('rejects an unsafe OSRM base URL: %s', (baseUrl) => {
    expect(() => readAppConfig({ ROUTING_OSRM_BASE_URL: baseUrl })).toThrow(
      'ROUTING_OSRM_BASE_URL',
    );
  });
});
