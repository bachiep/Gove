# Vertical Slice 04 — Authenticated Realtime Trip Updates

Status: Implemented and tested locally

Last updated: 2026-09-24

## Objective

Give a Customer a reconnectable Trip snapshot and live status channel after a
ride request, while allowing an authorized Driver to publish validated location
updates. Realtime delivery is a projection of committed state, not a second
business-state owner.

## Delivered boundary

- Raw WebSocket endpoint at `/ws` with first-message access-token
  authentication, authentication timeout, heartbeat, message validation, and
  per-Trip authorization.
- Reconnect snapshot containing the authoritative Trip state/version and latest
  Driver location when available.
- PostgreSQL transactional-outbox relay for Trip events, including dispatch
  matching and assignment outcomes.
- Driver location updates through the existing Location service, with accepted
  acknowledgements and broadcasts to current Trip subscribers.
- Operator-only realtime connection metrics endpoint.
- Customer PWA integration showing Trip state, Trip version, and connection
  status after the current ride request flow.

## Verification evidence

- Realtime integration tests pass for authentication, authorized snapshot,
  ping/pong, matching-event relay, Driver location authorization, and customer
  location broadcast.
- Web typecheck and production build pass.
- A manual browser smoke on a clean tab passes registration/login reuse, Fare Quote,
  Trip creation, bounded matching, `NO_DRIVER_AVAILABLE` rendering, connected
  live status, and zero console errors.

## Consistency and failure rules

PostgreSQL owns Trip, Dispatch, and Location state. The gateway only reads the
Trip snapshot, relays committed outbox rows, and calls the Location service. A
client must use the Trip version to reject stale messages. If outbox polling
fails, the gateway keeps the last cursor and retries; it does not acknowledge a
business transition independently.

## Exclusions

This slice does not claim multi-instance WebSocket fanout, broker-backed event
delivery, durable consumer checkpoints, offline message storage, route/ETA
calculation, or production-scale performance. Payment, completion, and Delivery
remain outside the current vertical slice.
