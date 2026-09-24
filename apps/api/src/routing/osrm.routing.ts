import {
  RoutingError,
  type RoutingCoordinatePair,
  type RoutingEstimate,
  type RoutingProvider,
  type RoutingRequest,
  validateRoutingRequest,
} from './routing.types.js';

const osrmSuccessCode = 'Ok';

export interface OsrmRoutingOptions {
  /** Base URL of a self-hosted or otherwise trusted OSRM HTTP endpoint. */
  readonly baseUrl: string;
}

/**
 * HTTP adapter for OSRM's route service. It deliberately exposes only the
 * stable RoutingProvider boundary, so callers do not depend on OSRM payloads.
 */
export class OsrmRoutingProvider implements RoutingProvider {
  readonly id = 'osrm';
  readonly version = 'osrm-route-v1';

  private readonly baseUrl: URL;

  constructor(options: OsrmRoutingOptions) {
    this.baseUrl = parseBaseUrl(options.baseUrl);
  }

  async route(
    input: RoutingRequest,
    signal: AbortSignal,
  ): Promise<RoutingEstimate> {
    validateRoutingRequest(input);

    if (signal.aborted) {
      throw abortedError();
    }

    let response: Response;
    try {
      response = await fetch(this.createRouteUrl(input), {
        method: 'GET',
        signal,
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        throw abortedError();
      }
      throw providerError('The OSRM routing request failed.');
    }

    if (signal.aborted) {
      throw abortedError();
    }

    if (!response.ok) {
      throw providerError(
        'The OSRM routing service returned an error response.',
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw providerError('The OSRM routing service returned invalid JSON.');
    }

    if (signal.aborted) {
      throw abortedError();
    }

    return parseRoute(payload);
  }

  private createRouteUrl(input: RoutingRequest): URL {
    const url = new URL(
      `route/v1/driving/${formatCoordinate(input.origin.longitude, input.origin.latitude)};${formatCoordinate(input.destination.longitude, input.destination.latitude)}`,
      this.baseUrl,
    );
    url.searchParams.set('alternatives', 'false');
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('steps', 'false');
    return url;
  }
}

function parseBaseUrl(baseUrl: string): URL {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new RoutingError(
      'INVALID_ROUTING_CONFIGURATION',
      'OSRM baseUrl must be a non-empty HTTP(S) URL.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new RoutingError(
      'INVALID_ROUTING_CONFIGURATION',
      'OSRM baseUrl must be a valid HTTP(S) URL.',
    );
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new RoutingError(
      'INVALID_ROUTING_CONFIGURATION',
      'OSRM baseUrl must be an HTTP(S) origin or path without credentials, query, or fragment.',
    );
  }

  return new URL(parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`);
}

function parseRoute(payload: unknown): RoutingEstimate {
  if (
    !isRecord(payload) ||
    payload.code !== osrmSuccessCode ||
    !Array.isArray(payload.routes)
  ) {
    throw providerError(
      'The OSRM routing service returned an invalid route response.',
    );
  }

  const route = payload.routes[0];
  if (!isRecord(route)) {
    throw providerError('The OSRM routing service returned no route.');
  }

  const distanceMeters = readNonNegativeNumber(route.distance);
  const duration = readNonNegativeNumber(route.duration);
  const coordinates = readLineStringCoordinates(route.geometry);
  if (distanceMeters === null || duration === null || coordinates === null) {
    throw providerError(
      'The OSRM routing service returned an invalid route estimate.',
    );
  }

  return {
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.ceil(duration),
    geometry: { type: 'LineString', coordinates },
  };
}

function readLineStringCoordinates(
  geometry: unknown,
): readonly RoutingCoordinatePair[] | null {
  if (
    !isRecord(geometry) ||
    geometry.type !== 'LineString' ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 2
  ) {
    return null;
  }

  const coordinates: RoutingCoordinatePair[] = [];
  for (const coordinate of geometry.coordinates) {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2 ||
      !isLongitude(coordinate[0]) ||
      !isLatitude(coordinate[1])
    ) {
      return null;
    }
    coordinates.push([coordinate[0], coordinate[1]]);
  }
  return coordinates;
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function isLongitude(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  );
}

function isLatitude(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatCoordinate(longitude: number, latitude: number): string {
  return `${longitude},${latitude}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function abortedError(): RoutingError {
  return new RoutingError(
    'ROUTING_PROVIDER_ABORTED',
    'The OSRM routing request was aborted.',
  );
}

function providerError(message: string): RoutingError {
  return new RoutingError('ROUTING_PROVIDER_ERROR', message);
}
