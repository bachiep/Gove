import { z } from 'zod';

import { latestLocationSchema } from '../location/location.schemas.js';

export const realtimeClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('authenticate'),
    accessToken: z.string().min(20).max(4096),
  }),
  z
    .object({
      type: z.literal('subscribe'),
      tripIds: z.array(z.uuid()).max(20).default([]),
      deliveryIds: z.array(z.uuid()).max(20).default([]),
    })
    .refine(
      (value) =>
        value.tripIds.length + value.deliveryIds.length >= 1 &&
        value.tripIds.length + value.deliveryIds.length <= 20,
      { message: 'Subscribe to between one and twenty aggregates.' },
    ),
  z.object({
    type: z.literal('location'),
    location: latestLocationSchema,
  }),
  z.object({ type: z.literal('ping') }),
]);

export type RealtimeClientMessage = z.output<
  typeof realtimeClientMessageSchema
>;

export type RealtimeServerMessage =
  | {
      type: 'authenticated';
      actorId: string;
      roles: string[];
    }
  | {
      type: 'trip.snapshot';
      snapshot: import('@gove/contracts').TripRealtimeSnapshot;
    }
  | {
      type: 'delivery.snapshot';
      snapshot: import('@gove/contracts').DeliveryRealtimeSnapshot;
    }
  | {
      type: 'trip.event';
      tripId: string;
      eventId: string;
      eventType: string;
      aggregateVersion: number;
      payload: unknown;
      occurredAt: string;
    }
  | {
      type: 'delivery.event';
      deliveryId: string;
      eventId: string;
      eventType: string;
      aggregateVersion: number;
      payload: unknown;
      occurredAt: string;
    }
  | {
      type: 'driver.location';
      tripId: string;
      driverId: string;
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      capturedAt: string;
      receivedAt: string;
    }
  | {
      type: 'delivery.driver.location';
      deliveryId: string;
      driverId: string;
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      capturedAt: string;
      receivedAt: string;
    }
  | {
      type: 'location.accepted';
      capturedAt: string;
      receivedAt: string;
      sequenceNumber: string;
    }
  | { type: 'pong' }
  | { type: 'error'; code: string; message: string };
