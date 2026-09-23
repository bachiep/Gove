import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { TripRealtimeSnapshot } from '@gove/contracts';
import type { IncomingMessage, Server } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

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
  tripIds: Set<string>;
  authTimer: NodeJS.Timeout;
  isAlive: boolean;
}

interface RealtimeMetricState {
  locationMessages: number;
  outboxEventsRelayed: number;
}

@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly clients = new Map<WebSocket, ClientState>();
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
  private readonly onUpgrade = (
    request: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) => {
    const pathname = new URL(request.url ?? '/', 'http://gove.local').pathname;
    if (pathname !== '/ws') return;
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
      for (const state of this.clients.values()) {
        if (!state.isAlive) {
          state.socket.terminate();
          continue;
        }
        state.isAlive = false;
        state.socket.ping();
      }
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
      subscriptions += state.tripIds.size;
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
      tripIds: new Set(),
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
      this.clients.delete(socket);
    });
    socket.on('error', () => {
      clearTimeout(state.authTimer);
      this.clients.delete(socket);
    });
  }

  private async handleMessage(state: ClientState, raw: string): Promise<void> {
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
    if (message.type === 'ping') {
      this.send(state.socket, { type: 'pong' });
      return;
    }
    if (message.type === 'subscribe') {
      await this.subscribe(state, message.tripIds);
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
      state.actor = await this.auth.authenticateAccessToken(accessToken);
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

  private async subscribe(
    state: ClientState,
    tripIds: string[],
  ): Promise<void> {
    const actor = state.actor;
    if (!actor) return;
    const snapshots: TripRealtimeSnapshot[] = [];
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
    state.tripIds = new Set(snapshots.map((snapshot) => snapshot.id));
    for (const snapshot of snapshots) {
      this.send(state.socket, { type: 'trip.snapshot', snapshot });
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
    } catch {
      this.sendError(
        state.socket,
        'LOCATION_REJECTED',
        'Location update was rejected.',
      );
    }
  }

  private async relayOutbox(): Promise<void> {
    try {
      const result = await this.repository.listOutboxAfter(this.cursor);
      this.cursor = result.cursor;
      for (const event of result.events) {
        this.revokeOfferSubscription(event.event_type, event.payload);
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

  private revokeOfferSubscription(eventType: string, payload: unknown): void {
    if (
      eventType !== 'dispatch.offer.rejected' &&
      eventType !== 'dispatch.offer.expired'
    )
      return;
    if (!payload || typeof payload !== 'object') return;
    const driverUserId = (payload as { driverUserId?: unknown }).driverUserId;
    if (typeof driverUserId !== 'string') return;
    for (const state of this.clients.values()) {
      if (state.actor?.id === driverUserId) {
        state.tripIds.delete((payload as { tripId?: string }).tripId ?? '');
      }
    }
  }

  private send(socket: WebSocket, message: RealtimeServerMessage): void {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    this.send(socket, { type: 'error', code, message });
  }
}
