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

/**
 * Product-level cancellation reasons shared by Customer, Driver, and Operator
 * cancellation commands. `OTHER` is deliberately retained for a concise,
 * validated explanation when no fixed reason applies.
 */
export const cancellationReasonCodes = [
  'CHANGE_OF_PLANS',
  'DRIVER_DELAY',
  'DRIVER_REQUESTED_CANCELLATION',
  'SAFETY_CONCERN',
  'VEHICLE_ISSUE',
  'OTHER',
] as const;
export type CancellationReasonCode = (typeof cancellationReasonCodes)[number];

export const cancellationActorRoles = [
  'CUSTOMER',
  'DRIVER',
  'OPERATOR',
] as const;
export type CancellationActorRole = (typeof cancellationActorRoles)[number];

export const tripCancellationRuleCodes = [
  'CUSTOMER_PRE_TRIP',
  'CUSTOMER_AT_PICKUP',
  'DRIVER_AT_PICKUP',
  'OPERATOR_PRE_TRIP',
  'OPERATOR_ASSIGNED',
  'OPERATOR_IN_PROGRESS',
] as const;
export type TripCancellationRuleCode =
  (typeof tripCancellationRuleCodes)[number];

export interface RideLocation {
  label: string;
  latitude: number;
  longitude: number;
}

export interface FareQuoteRoute {
  geometry: {
    type: 'LineString';
    coordinates: readonly (readonly [number, number])[];
  };
  provider: string;
  version: string;
  updatedAt: string;
  usedFallback: boolean;
  fallbackReason:
    'PRIMARY_NOT_CONFIGURED' | 'PRIMARY_ERROR' | 'PRIMARY_TIMEOUT' | null;
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
  /** Optional for replay compatibility with receipts created before routing provenance was exposed. */
  route?: FareQuoteRoute;
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

export interface TripDetailResponse extends TripResponse {
  driverId: string | null;
  actualDistanceMeters: number | null;
  actualDurationSeconds: number | null;
  finalFareMinor: number | null;
  completedAt: string | null;
}

export interface ActiveTripResponse extends TripDetailResponse {
  pickup: RideLocation;
  dropoff: RideLocation;
}

/**
 * PII-minimized cancellation record exposed to the Trip owner or assigned
 * Driver. The optional free-text reason is intentionally not part of API or
 * realtime response contracts.
 */
export interface TripCancellationSummary {
  cancelledByRole: CancellationActorRole;
  reasonCode: CancellationReasonCode;
  ruleCode: TripCancellationRuleCode;
  cancelledAt: string;
}

export interface CancelTripResponse extends TripDetailResponse {
  cancellation: TripCancellationSummary;
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

export interface TripRealtimeSnapshot extends TripDetailResponse {
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

export const paymentStatuses = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

export const paymentProviders = ['SIMULATOR', 'MOMO', 'SEPAY'] as const;
export type PaymentProvider = (typeof paymentProviders)[number];

export interface PaymentAttemptResponse {
  id: string;
  tripId: string;
  attemptNumber: number;
  amountMinor: number;
  currency: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  providerReference: string | null;
  failureCode: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

export interface TripHistoryItem extends TripDetailResponse {
  paymentStatus: PaymentStatus | null;
}

/**
 * Deliberately PII-minimized Trip state record for the Operator diagnostic
 * timeline. Customer, Driver, location, payment, and free-text reason data
 * are intentionally excluded from this read model.
 */
export interface OperatorTripTimelineTransition {
  command: string;
  fromState: TripState | null;
  toState: TripState;
  fromVersion: number | null;
  toVersion: number;
  correlationId: string;
  createdAt: string;
}

export interface OperatorDiagnosticAuditSummary {
  id: string;
  action: 'DIAGNOSTIC_REVIEW';
  correlationId: string;
  createdAt: string;
}

export interface OperatorTripDiagnosticTimelineResponse {
  trip: {
    id: string;
    state: TripState;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  transitions: OperatorTripTimelineTransition[];
  diagnosticAudits: OperatorDiagnosticAuditSummary[];
}

export interface OperatorDiagnosticAuditResponse extends OperatorDiagnosticAuditSummary {
  reason: string;
}

export const deliveryStates = [
  'REQUESTED',
  'MATCHING',
  'DRIVER_TO_PICKUP',
  'AT_PICKUP',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
  'NO_DRIVER_AVAILABLE',
] as const;
export type DeliveryState = (typeof deliveryStates)[number];

export interface DeliveryResponse {
  id: string;
  state: DeliveryState;
  version: number;
  pickup: RideLocation;
  dropoff: RideLocation;
  recipientDisplayName: string;
  parcelDescription: string;
  declaredWeightGrams: number;
  createdAt: string;
}

export interface DeliveryRealtimeSnapshot extends DeliveryResponse {
  driverId: string | null;
  /**
   * Optional because older snapshot producers only return assignment data.
   * A producer may include the latest persisted location when available;
   * streamed `delivery.driver.location` messages remain the live update path.
   */
  driverLocation?: DriverLocationSnapshot | null;
}

export type DeliveryOfferState = 'PENDING' | 'ACCEPTED' | 'EXPIRED';

export interface DeliveryOfferResponse {
  id: string;
  deliveryId: string;
  driverId: string;
  attemptNumber: number;
  status: DeliveryOfferState;
  expiresAt: string;
  deliveryState: DeliveryState;
  deliveryVersion: number;
}

export interface DeliveryMatchResponse {
  deliveryId: string;
  deliveryState: DeliveryState;
  deliveryVersion: number;
  offer: DeliveryOfferResponse | null;
}
