import { afterEach, describe, expect, it, vi } from 'vitest';

import { OsrmRoutingProvider } from './osrm.routing.js';

const routeRequest = {
  origin: { latitude: 21.0285, longitude: 105.8542 },
  destination: { latitude: 21.0381, longitude: 105.8342 },
  profile: 'DRIVING' as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OsrmRoutingProvider', () => {
  it('requests a GeoJSON driving route and maps its validated estimate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 'Ok',
        routes: [
          {
            distance: 2_345.4,
            duration: 120.1,
            geometry: {
              type: 'LineString',
              coordinates: [
                [105.8542, 21.0285],
                [105.844, 21.033],
                [105.8342, 21.0381],
              ],
            },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OsrmRoutingProvider({
      baseUrl: 'http://osrm.internal:5000/',
    });

    await expect(
      provider.route(routeRequest, new AbortController().signal),
    ).resolves.toEqual({
      distanceMeters: 2_345,
      durationSeconds: 121,
      geometry: {
        type: 'LineString',
        coordinates: [
          [105.8542, 21.0285],
          [105.844, 21.033],
          [105.8342, 21.0381],
        ],
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        'http://osrm.internal:5000/route/v1/driving/105.8542,21.0285;105.8342,21.0381?alternatives=false&overview=full&geometries=geojson&steps=false',
      ),
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    { code: 'NoRoute', routes: [] },
    { code: 'Ok', routes: [] },
    { code: 'Ok', routes: [{ distance: -1, duration: 1, geometry: {} }] },
    {
      code: 'Ok',
      routes: [
        {
          distance: 1,
          duration: 1,
          geometry: { type: 'LineString', coordinates: [[105, 21]] },
        },
      ],
    },
  ])('rejects malformed OSRM payloads defensively: %#', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));
    const provider = new OsrmRoutingProvider({
      baseUrl: 'https://osrm.example.test',
    });

    await expect(
      provider.route(routeRequest, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'ROUTING_PROVIDER_ERROR',
    });
  });

  it('propagates the caller abort signal to fetch and maps aborts consistently', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: URL, options: RequestInit) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OsrmRoutingProvider({
      baseUrl: 'https://osrm.example.test',
    });

    await expect(
      provider.route(routeRequest, controller.signal),
    ).rejects.toMatchObject({
      code: 'ROUTING_PROVIDER_ABORTED',
    });
  });

  it('does not invoke fetch when the supplied signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    const provider = new OsrmRoutingProvider({
      baseUrl: 'https://osrm.example.test',
    });

    await expect(
      provider.route(routeRequest, controller.signal),
    ).rejects.toMatchObject({
      code: 'ROUTING_PROVIDER_ABORTED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps transport and HTTP failures without exposing provider details', async () => {
    const provider = new OsrmRoutingProvider({
      baseUrl: 'https://osrm.example.test',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network unavailable')),
    );
    await expect(
      provider.route(routeRequest, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'ROUTING_PROVIDER_ERROR',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false)));
    await expect(
      provider.route(routeRequest, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'ROUTING_PROVIDER_ERROR',
    });
  });

  it.each([
    '',
    'not a url',
    'ftp://osrm.example.test',
    'https://username:password@osrm.example.test',
    'https://osrm.example.test/?token=secret',
  ])('rejects unsafe or invalid base URL configuration: %s', (baseUrl) => {
    expect(() => new OsrmRoutingProvider({ baseUrl })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ROUTING_CONFIGURATION' }),
    );
  });
});

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}
