export type RoutingProfile = 'DRIVING';

export interface RoutingCoordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface RoutingRequest {
  readonly origin: RoutingCoordinate;
  readonly destination: RoutingCoordinate;
  readonly profile: RoutingProfile;
}

export type RoutingCoordinatePair = readonly [
  longitude: number,
  latitude: number,
];

export interface RoutingGeometry {
  readonly type: 'LineString';
  readonly coordinates: readonly RoutingCoordinatePair[];
}

/** Provider output before the routing seam adds freshness and provenance. */
export interface RoutingEstimate {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly geometry: RoutingGeometry;
}

/**
 * Adapter seam for a road-routing provider. Implementations must honor an
 * aborted signal where their underlying transport supports cancellation.
 */
export interface RoutingProvider {
  readonly id: string;
  readonly version: string;
  route(input: RoutingRequest, signal: AbortSignal): Promise<RoutingEstimate>;
}

export interface RoutingMetadata {
  readonly provider: string;
  readonly version: string;
  readonly updatedAt: string;
}

export type RoutingFallbackReason =
  'PRIMARY_NOT_CONFIGURED' | 'PRIMARY_ERROR' | 'PRIMARY_TIMEOUT';

export interface RoutingResult extends RoutingEstimate {
  readonly metadata: RoutingMetadata;
  readonly usedFallback: boolean;
  readonly fallbackReason: RoutingFallbackReason | null;
}

export type RoutingErrorCode =
  | 'INVALID_ROUTING_INPUT'
  | 'INVALID_ROUTING_CONFIGURATION'
  | 'ROUTING_PROVIDER_TIMEOUT'
  | 'ROUTING_PROVIDER_ERROR'
  | 'ROUTING_UNAVAILABLE'
  | 'ROUTING_PROVIDER_ABORTED';

export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

export function validateRoutingRequest(input: RoutingRequest): void {
  validateCoordinate(input.origin, 'origin');
  validateCoordinate(input.destination, 'destination');

  if (input.profile !== 'DRIVING') {
    throw new RoutingError(
      'INVALID_ROUTING_INPUT',
      'Only the DRIVING routing profile is supported by the MVP boundary.',
    );
  }
}

function validateCoordinate(
  coordinate: RoutingCoordinate,
  field: string,
): void {
  if (
    !Number.isFinite(coordinate.latitude) ||
    coordinate.latitude < -90 ||
    coordinate.latitude > 90
  ) {
    throw new RoutingError(
      'INVALID_ROUTING_INPUT',
      `${field}.latitude must be a finite value between -90 and 90.`,
    );
  }

  if (
    !Number.isFinite(coordinate.longitude) ||
    coordinate.longitude < -180 ||
    coordinate.longitude > 180
  ) {
    throw new RoutingError(
      'INVALID_ROUTING_INPUT',
      `${field}.longitude must be a finite value between -180 and 180.`,
    );
  }
}
