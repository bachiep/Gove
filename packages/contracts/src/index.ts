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

export const tripStates = [
  'REQUESTED',
  'MATCHING',
  'DRIVER_TO_PICKUP',
  'AT_PICKUP',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVER_AVAILABLE',
] as const;
export type TripState = (typeof tripStates)[number];

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
  state: TripState;
  version: number;
  currency: string;
  quotedTotalFareMinor: number;
  createdAt: string;
}

export const driverWorkStates = [
  'OFFLINE',
  'AVAILABLE',
  'RESERVED',
  'TO_PICKUP',
  'ON_TRIP',
] as const;
export type DriverWorkState = (typeof driverWorkStates)[number];

export const tripOfferStates = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'REVOKED',
] as const;
export type TripOfferState = (typeof tripOfferStates)[number];

export interface TripOfferResponse {
  id: string;
  tripId: string;
  driverId: string;
  attemptNumber: number;
  status: TripOfferState;
  expiresAt: string;
  tripState: TripState;
  tripVersion: number;
}

export interface DispatchMatchResponse {
  tripId: string;
  tripState: TripState;
  tripVersion: number;
  offer: TripOfferResponse | null;
}

export interface DriverLocationSnapshot {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  receivedAt: string;
}

export interface TripRealtimeSnapshot extends TripResponse {
  driverId: string | null;
  driverLocation: DriverLocationSnapshot | null;
}

export interface RealtimeMetricsResponse {
  activeConnections: number;
  authenticatedConnections: number;
  subscriptions: number;
  locationMessages: number;
  outboxEventsRelayed: number;
}

export interface DispatchOfferRejectionResponse {
  rejectedOffer: TripOfferResponse;
  reassignedOffer: TripOfferResponse | null;
}
