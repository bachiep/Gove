import {
  RoutingError,
  type RoutingEstimate,
  type RoutingProvider,
  type RoutingRequest,
  validateRoutingRequest,
} from './routing.types.js';

const earthRadiusMeters = 6_371_008.8;
const defaultSpeedMetersPerSecond = 5;

export interface CoordinateFallbackOptions {
  readonly speedMetersPerSecond?: number;
}

/**
 * Deterministic local adapter. It estimates a straight coordinate segment and
 * must never be described as a shortest road route or a production ETA.
 */
export class CoordinateFallbackRoutingProvider implements RoutingProvider {
  readonly id = 'coordinate-fallback';
  readonly version = 'coordinate-fallback-v1';

  private readonly speedMetersPerSecond: number;

  constructor(options: CoordinateFallbackOptions = {}) {
    const speedMetersPerSecond =
      options.speedMetersPerSecond ?? defaultSpeedMetersPerSecond;

    if (!Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond <= 0) {
      throw new RoutingError(
        'INVALID_ROUTING_CONFIGURATION',
        'speedMetersPerSecond must be a finite value greater than zero.',
      );
    }

    this.speedMetersPerSecond = speedMetersPerSecond;
  }

  async route(
    input: RoutingRequest,
    signal: AbortSignal,
  ): Promise<RoutingEstimate> {
    validateRoutingRequest(input);

    if (signal.aborted) {
      throw new RoutingError(
        'ROUTING_PROVIDER_ABORTED',
        'The coordinate fallback route was aborted.',
      );
    }

    const distanceMeters = Math.round(
      haversineMeters(input.origin, input.destination),
    );

    return {
      distanceMeters,
      durationSeconds: Math.ceil(distanceMeters / this.speedMetersPerSecond),
      geometry: {
        type: 'LineString',
        coordinates: [
          [input.origin.longitude, input.origin.latitude],
          [input.destination.longitude, input.destination.latitude],
        ],
      },
    };
  }
}

function haversineMeters(
  origin: RoutingRequest['origin'],
  destination: RoutingRequest['destination'],
): number {
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 *
    earthRadiusMeters *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
