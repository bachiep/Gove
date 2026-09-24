import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type {
  DeliveryRealtimeSnapshot,
  TripRealtimeSnapshot,
} from '@gove/contracts';
import type { IncomingMessage, Server } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

import { ApiError } from '../common/http/api-error.js';
import { readAppConfig } from '../config/app-config.js';
import { AuthService } from '../identity/auth.service.js';
import type { SessionActor } from '../identity/identity.types.js';
import { LocationService } from '../location/location.service.js';
import type { LatestLocationInput } from '../location/location.schemas.js';
import {
  realtimeClientMessageSchema,
  type RealtimeServerMessage,
} from './realtime.protocol.js';
import {
  RealtimeRepository,
  type OutboxCursor,
} from './realtime.repository.js';

interface ClientState {
  socket: WebSocket;
  actor: SessionActor | null;
  accessToken: string | null;
  authRevalidation: Promise<void> | null;
  tripIds: Set<string>;
  deliveryIds: Set<string>;
  messageQuota: QuotaWindow;
  authTimer: NodeJS.Timeout;
  isAlive: boolean;
}

interface QuotaWindow {
  startedAt: number;
  count: number;
}

interface RealtimeMetricState {
  locationMessages: number;
  outboxEventsRelayed: number;
}

const connectionMessageQuota = {
  limit: 60,
  windowMilliseconds: 10_000,
} as const;
const actorLocationQuota = {
  limit: 1,
  windowMilliseconds: 3_000,
} as const;
const maximumSubscriptionsPerConnection = 20;
const terminalTripEventTypes = new Set([
  'trip.completed',
  'trip.cancelled',
  'trip.no_driver_available',
]);
const terminalDeliveryEventTypes = new Set([
  'delivery.completed',
  'delivery.cancelled',
  'delivery.failed',
  'delivery.no_driver_available',
]);

@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly config = readAppConfig();
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly actorLocationQuotas = new Map<string, QuotaWindow>();
  private readonly metrics: RealtimeMetricState = {
    locationMessages: 0,
    outboxEventsRelayed: 0,
  };
  private webSocketServer?: WebSocketServer;
  private httpServer?: Server;
  private relayTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private cursor: OutboxCursor = {
    occurredAt: new Date(),
    id: '00000000-0000-0000-0000-000000000000',
  };
  private deliveryCursor: OutboxCursor = {
    occurredAt: new Date(),
    id: '00000000-0000-0000-0000-000000000000',
  };
  private readonly onUpgrade = (
    request: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) => {
    const pathname = new URL(request.url ?? '/', 'http://gove.local').pathname;
    if (pathname !== '/ws') return;
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== this.config.WEB_ORIGIN) {
      socket.write(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      socket.destroy();
      return;
    }
    this.webSocketServer?.handleUpgrade(request, socket, head, (client) => {
      this.webSocketServer?.emit('connection', client, request);
    });
  };

  constructor(
    @Inject(HttpAdapterHost)
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(LocationService) private readonly locations: LocationService,
    @Inject(RealtimeRepository)
    private readonly repository: RealtimeRepository,
  ) {}

  onModuleInit(): void {
    this.httpServer =
      this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
    this.webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: 64 * 1024,
    });
    this.httpServer.on('upgrade', this.onUpgrade);
    this.webSocketServer.on('connection', (socket) =>
      this.handleConnection(socket),
    );
    this.relayTimer = setInterval(() => {
      void this.relayOutbox();
    }, 250);
    this.relayTimer.unref();
    this.heartbeatTimer = setInterval(() => {
      this.runHeartbeat();
    }, 30_000);
    this.heartbeatTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.relayTimer) clearInterval(this.relayTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.httpServer?.off('upgrade', this.onUpgrade);
    for (const state of this.clients.values()) state.socket.close(1001);
    this.clients.clear();
    this.webSocketServer?.close();
  }

  getMetrics() {
    let subscriptions = 0;
    let authenticatedConnections = 0;
    for (const state of this.clients.values()) {
      subscriptions += state.tripIds.size + state.deliveryIds.size;
      if (state.actor) authenticatedConnections += 1;
    }
    return {
      activeConnections: this.clients.size,
      authenticatedConnections,
      subscriptions,
      ...this.metrics,
    };
  }

  private handleConnection(socket: WebSocket): void {
    const state: ClientState = {
      socket,
      actor: null,
      accessToken: null,
      authRevalidation: null,
      tripIds: new Set(),
      deliveryIds: new Set(),
      messageQuota: { startedAt: Date.now(), count: 0 },
      isAlive: true,
      authTimer: setTimeout(() => {
        if (!state.actor) socket.close(1008, 'Authentication required');
      }, 5_000),
    };
    state.authTimer.unref();
    this.clients.set(socket, state);
    socket.on('pong', () => {
      state.isAlive = true;
    });
    socket.on('message', (raw) => {
      void this.handleMessage(state, raw.toString()).catch(() => {
        this.sendError(
          state.socket,
          'REALTIME_REQUEST_FAILED',
          'The realtime request could not be completed.',
        );
      });
    });
    socket.on('close', () => {
      clearTimeout(state.authTimer);
      state.accessToken = null;
      state.actor = null;
      this.clients.delete(socket);
    });
    socket.on('error', () => {
      clearTimeout(state.authTimer);
      state.accessToken = null;
      state.actor = null;
      this.clients.delete(socket);
    });
  }

  private async handleMessage(state: ClientState, raw: string): Promise<void> {
    if (!this.consumeQuota(state.messageQuota, connectionMessageQuota)) {
      this.sendError(
        state.socket,
        'MESSAGE_RATE_LIMITED',
        'Too many realtime messages. Wait before sending more messages.',
      );
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      this.sendError(state.socket, 'INVALID_MESSAGE', 'Message must be JSON.');
      return;
    }
    const parsed = realtimeClientMessageSchema.safeParse(value);
    if (!parsed.success) {
      this.sendError(
        state.socket,
        'INVALID_MESSAGE',
        'Message shape is invalid.',
      );
      return;
    }
    const message = parsed.data;
    if (message.type === 'authenticate') {
      await this.authenticate(state, message.accessToken);
      return;
    }
    if (!state.actor) {
      this.sendError(state.socket, 'AUTH_REQUIRED', 'Authenticate first.');
      return;
    }
    if (state.authRevalidation) {
      await state.authRevalidation;
      if (!state.actor || state.socket.readyState !== WebSocket.OPEN) return;
    }
    if (message.type === 'ping') {
      this.send(state.socket, { type: 'pong' });
      return;
    }
    if (message.type === 'subscribe') {
      await this.subscribe(state, message.tripIds, message.deliveryIds);
      return;
    }
    if (message.type === 'location') {
      await this.updateLocation(state, message.location);
    }
  }

  private async authenticate(
    state: ClientState,
    accessToken: string,
  ): Promise<void> {
    if (state.actor) {
      this.sendError(
        state.socket,
        'ALREADY_AUTHENTICATED',
        'Session is already authenticated.',
      );
      return;
    }
    try {
      const actor = await this.auth.authenticateAccessToken(accessToken);
      state.accessToken = accessToken;
      state.actor = actor;
      clearTimeout(state.authTimer);
      this.send(state.socket, {
        type: 'authenticated',
        actorId: state.actor.id,
        roles: state.actor.roles,
      });
    } catch {
      this.sendError(
        state.socket,
        'AUTH_INVALID',
        'The access token is invalid.',
      );
      state.socket.close(1008, 'Invalid access token');
    }
  }

  private runHeartbeat(): void {
    for (const state of this.clients.values()) {
      if (state.actor) void this.revalidateAuthentication(state);
      if (!state.isAlive) {
        state.socket.terminate();
        continue;
      }
      state.isAlive = false;
      state.socket.ping();
    }
  }

  private revalidateAuthentication(state: ClientState): Promise<void> {
    if (!state.actor || !state.accessToken) return Promise.resolve();
    if (state.authRevalidation) return state.authRevalidation;

    const revalidation = this.performAuthenticationRevalidation(state);
    state.authRevalidation = revalidation;
    const clearInFlight = () => {
      if (state.authRevalidation === revalidation) {
        state.authRevalidation = null;
      }
    };
    void revalidation.then(clearInFlight, clearInFlight);
    return revalidation;
  }

  private async performAuthenticationRevalidation(
    state: ClientState,
  ): Promise<void> {
    const accessToken = state.accessToken;
    if (!state.actor || !accessToken) return;
    try {
      const actor = await this.auth.authenticateAccessToken(accessToken);
      if (state.socket.readyState !== WebSocket.OPEN) return;
      state.actor = actor;
    } catch {
      state.actor = null;
      state.accessToken = null;
      if (state.socket.readyState !== WebSocket.OPEN) return;
      this.sendError(
        state.socket,
        'AUTH_REAUTH_REQUIRED',
        'Realtime authentication expired or was revoked. Authenticate again.',
      );
      state.socket.close(1008, 'AUTH_REAUTH_REQUIRED');
    }
  }

  private async subscribe(
    state: ClientState,
    tripIds: string[],
    deliveryIds: string[],
  ): Promise<void> {
    const actor = state.actor;
    if (!actor) return;
    const snapshots: TripRealtimeSnapshot[] = [];
    const deliverySnapshots: DeliveryRealtimeSnapshot[] = [];
    for (const tripId of tripIds) {
      const snapshot = await this.repository.findAuthorizedTripSnapshot(
        actor.id,
        tripId,
      );
      if (!snapshot) {
        this.sendError(
          state.socket,
          'TRIP_ACCESS_DENIED',
          'Trip subscription is not allowed.',
        );
        continue;
      }
      snapshots.push(snapshot);
    }
    for (const deliveryId of deliveryIds) {
      const snapshot = await this.repository.findAuthorizedDeliverySnapshot(
        actor.id,
        deliveryId,
      );
      if (!snapshot) {
        this.sendError(
          state.socket,
          'DELIVERY_ACCESS_DENIED',
          'Delivery subscription is not allowed.',
        );
        continue;
      }
      deliverySnapshots.push(snapshot);
    }
    for (const snapshot of snapshots) {
      if (!this.addTripSubscription(state, snapshot.id)) continue;
      this.send(state.socket, { type: 'trip.snapshot', snapshot });
    }
    for (const snapshot of deliverySnapshots) {
      if (!this.addDeliverySubscription(state, snapshot.id)) continue;
      this.send(state.socket, { type: 'delivery.snapshot', snapshot });
    }
  }

  private async updateLocation(
    state: ClientState,
    location: LatestLocationInput,
  ): Promise<void> {
    const actor = state.actor;
    if (!actor?.roles.includes('DRIVER')) {
      this.sendError(
        state.socket,
        'AUTH_FORBIDDEN',
        'Only Drivers can send location.',
      );
      return;
    }
    if (!this.consumeActorLocationQuota(actor.id)) {
      this.sendError(
        state.socket,
        'LOCATION_RATE_LIMITED',
        'Location update attempts are limited to one every 3 seconds.',
      );
      return;
    }
    try {
      const result = await this.locations.updateLatest(actor.id, location);
      if (!result.accepted) {
        this.sendError(
          state.socket,
          'LOCATION_STALE',
          'The location sequence is older than the latest accepted update.',
        );
        return;
      }
      this.metrics.locationMessages += 1;
      this.send(state.socket, {
        type: 'location.accepted',
        capturedAt: result.captured_at.toISOString(),
        receivedAt: result.received_at.toISOString(),
        sequenceNumber: result.sequence_number,
      });
      const tripIds = await this.repository.findCurrentTripIdsForDriver(
        actor.id,
      );
      for (const tripId of tripIds) {
        this.broadcast(tripId, {
          type: 'driver.location',
          tripId,
          driverId: actor.id,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: location.accuracyMeters,
          capturedAt: result.captured_at.toISOString(),
          receivedAt: result.received_at.toISOString(),
        });
      }
      const deliveryIds = await this.repository.findCurrentDeliveryIdsForDriver(
        actor.id,
      );
      for (const deliveryId of deliveryIds) {
        this.broadcastDelivery(deliveryId, {
          type: 'delivery.driver.location',
          deliveryId,
          driverId: actor.id,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: location.accuracyMeters,
          capturedAt: result.captured_at.toISOString(),
          receivedAt: result.received_at.toISOString(),
        });
      }
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'DRIVER_LOCATION_RATE_LIMITED'
      ) {
        this.sendError(
          state.socket,
          'LOCATION_RATE_LIMITED',
          'Location update attempts are limited to one every 3 seconds.',
        );
        return;
      }
      this.sendError(
        state.socket,
        'LOCATION_REJECTED',
        'Location update was rejected.',
      );
    }
  }

  private async relayOutbox(): Promise<void> {
    try {
      const tripResult = await this.repository.listOutboxAfter(this.cursor);
      this.cursor = tripResult.cursor;
      for (const event of orderAggregateEvents(
        tripResult.events,
        (candidate) => candidate.trip_id,
      )) {
        this.metrics.outboxEventsRelayed += 1;
        this.broadcast(event.trip_id, {
          type: 'trip.event',
          tripId: event.trip_id,
          eventId: event.id,
          eventType: event.event_type,
          aggregateVersion: event.aggregate_version,
          payload: event.payload,
          occurredAt: event.occurred_at.toISOString(),
        });
        this.revokeTripSubscription(
          event.trip_id,
          event.event_type,
          event.payload,
        );
      }
      const deliveryResult = await this.repository.listDeliveryOutboxAfter(
        this.deliveryCursor,
      );
      this.deliveryCursor = deliveryResult.cursor;
      for (const event of orderAggregateEvents(
        deliveryResult.events,
        (candidate) => candidate.delivery_id,
      )) {
        this.metrics.outboxEventsRelayed += 1;
        this.broadcastDelivery(event.delivery_id, {
          type: 'delivery.event',
          deliveryId: event.delivery_id,
          eventId: event.id,
          eventType: event.event_type,
          aggregateVersion: event.aggregate_version,
          payload: event.payload,
          occurredAt: event.occurred_at.toISOString(),
        });
        this.revokeDeliverySubscription(event.delivery_id, event.event_type);
      }
    } catch {
      // The database remains the source of truth; the next poll retries.
    }
  }

  private broadcast(tripId: string, message: RealtimeServerMessage): void {
    for (const state of this.clients.values()) {
      if (state.actor && state.tripIds.has(tripId))
        this.send(state.socket, message);
    }
  }

  private broadcastDelivery(
    deliveryId: string,
    message: RealtimeServerMessage,
  ): void {
    for (const state of this.clients.values()) {
      if (state.actor && state.deliveryIds.has(deliveryId))
        this.send(state.socket, message);
    }
  }

  private addTripSubscription(state: ClientState, tripId: string): boolean {
    if (state.tripIds.has(tripId)) return true;
    if (!this.hasSubscriptionCapacity(state)) {
      this.sendError(
        state.socket,
        'SUBSCRIPTION_LIMIT_EXCEEDED',
        'A connection can subscribe to at most twenty aggregates.',
      );
      return false;
    }
    state.tripIds.add(tripId);
    return true;
  }

  private addDeliverySubscription(
    state: ClientState,
    deliveryId: string,
  ): boolean {
    if (state.deliveryIds.has(deliveryId)) return true;
    if (!this.hasSubscriptionCapacity(state)) {
      this.sendError(
        state.socket,
        'SUBSCRIPTION_LIMIT_EXCEEDED',
        'A connection can subscribe to at most twenty aggregates.',
      );
      return false;
    }
    state.deliveryIds.add(deliveryId);
    return true;
  }

  private hasSubscriptionCapacity(state: ClientState): boolean {
    return (
      state.tripIds.size + state.deliveryIds.size <
      maximumSubscriptionsPerConnection
    );
  }

  private revokeTripSubscription(
    tripId: string,
    eventType: string,
    payload: unknown,
  ): void {
    if (terminalTripEventTypes.has(eventType)) {
      for (const state of this.clients.values()) state.tripIds.delete(tripId);
      return;
    }
    if (!payload || typeof payload !== 'object') return;
    const value = payload as {
      tripId?: unknown;
      driverUserId?: unknown;
      driverUserIds?: unknown;
    };
    const driverUserIds =
      eventType === 'trip.cancelled' && Array.isArray(value.driverUserIds)
        ? value.driverUserIds.filter(
            (driverUserId): driverUserId is string =>
              typeof driverUserId === 'string',
          )
        : eventType === 'dispatch.offer.rejected' ||
            eventType === 'dispatch.offer.expired'
          ? typeof value.driverUserId === 'string'
            ? [value.driverUserId]
            : []
          : [];
    if (driverUserIds.length === 0) return;
    for (const state of this.clients.values()) {
      if (state.actor && driverUserIds.includes(state.actor.id)) {
        state.tripIds.delete(tripId);
      }
    }
  }

  private revokeDeliverySubscription(
    deliveryId: string,
    eventType: string,
  ): void {
    if (!terminalDeliveryEventTypes.has(eventType)) return;
    for (const state of this.clients.values()) {
      state.deliveryIds.delete(deliveryId);
    }
  }

  private send(socket: WebSocket, message: RealtimeServerMessage): void {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    this.send(socket, { type: 'error', code, message });
  }

  private consumeActorLocationQuota(actorId: string): boolean {
    const now = Date.now();
    for (const [id, quota] of this.actorLocationQuotas) {
      if (now - quota.startedAt >= actorLocationQuota.windowMilliseconds) {
        this.actorLocationQuotas.delete(id);
      }
    }
    const quota = this.actorLocationQuotas.get(actorId) ?? {
      startedAt: now,
      count: 0,
    };
    if (!this.consumeQuota(quota, actorLocationQuota, now)) return false;
    this.actorLocationQuotas.set(actorId, quota);
    return true;
  }

  private consumeQuota(
    quota: QuotaWindow,
    policy: { limit: number; windowMilliseconds: number },
    now = Date.now(),
  ): boolean {
    if (now - quota.startedAt >= policy.windowMilliseconds) {
      quota.startedAt = now;
      quota.count = 0;
    }
    if (quota.count >= policy.limit) return false;
    quota.count += 1;
    return true;
  }
}

/**
 * Outbox rows from one transaction share `occurred_at`; their UUID values do
 * not encode domain order. Keep the database cursor order between aggregates,
 * but restore aggregate-version order before emitting to a subscriber. This is
 * important when a terminal event would otherwise revoke a subscription before
 * its preceding state-change event is delivered.
 */
function orderAggregateEvents<
  T extends { aggregate_version: number; occurred_at: Date; id: string },
>(events: readonly T[], aggregateId: (event: T) => string): T[] {
  const indexed = events.map((event, index) => ({ event, index }));
  const firstIndexes = new Map<string, number>();
  for (const candidate of indexed) {
    const id = aggregateId(candidate.event);
    if (!firstIndexes.has(id)) firstIndexes.set(id, candidate.index);
  }
  return indexed
    .sort((left, right) => {
      const aggregateIndexDifference =
        (firstIndexes.get(aggregateId(left.event)) ?? left.index) -
        (firstIndexes.get(aggregateId(right.event)) ?? right.index);
      if (aggregateIndexDifference !== 0) return aggregateIndexDifference;
      const versionDifference =
        left.event.aggregate_version - right.event.aggregate_version;
      if (versionDifference !== 0) return versionDifference;
      const timeDifference =
        left.event.occurred_at.getTime() - right.event.occurred_at.getTime();
      if (timeDifference !== 0) return timeDifference;
      return left.event.id.localeCompare(right.event.id);
    })
    .map(({ event }) => event);
}
