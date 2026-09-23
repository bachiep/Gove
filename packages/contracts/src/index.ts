export interface HealthResponse {
  service: 'gove-api';
  status: 'ok';
  timestamp: string;
}

export interface ReadinessResponse extends HealthResponse {
  dependencies: {
    postgres: 'ready';
    postgis: string;
  };
}

export const roleCodes = ['CUSTOMER', 'DRIVER', 'OPERATOR'] as const;
export type RoleCode = (typeof roleCodes)[number];

export interface AuthenticatedActor {
  id: string;
  displayName: string;
  email: string;
  roles: RoleCode[];
}

export interface AuthenticationResponse {
  accessToken: string;
  actor: AuthenticatedActor;
}

export interface RegistrationResponse {
  actor: AuthenticatedActor;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  correlationId: string;
  details?: Array<{ field: string; reason: string }>;
}

export const serviceTypes = ['MOTORBIKE_STANDARD', 'CAR_STANDARD'] as const;
export type ServiceType = (typeof serviceTypes)[number];

export interface RideLocation {
  label: string;
  latitude: number;
  longitude: number;
}

export interface FareQuoteResponse {
  id: string;
  serviceType: ServiceType;
  pickup: RideLocation;
  dropoff: RideLocation;
  estimatedDistanceMeters: number;
  estimatedDurationSeconds: number;
  currency: string;
  totalFareMinor: number;
  expiresAt: string;
}

export interface TripResponse {
  id: string;
  fareQuoteId: string;
  serviceType: ServiceType;
  state: 'REQUESTED';
  version: 0;
  currency: string;
  quotedTotalFareMinor: number;
  createdAt: string;
}
