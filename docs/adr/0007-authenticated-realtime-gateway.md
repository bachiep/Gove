# ADR 0007: Authenticated Realtime Gateway

Status: Accepted

Date: 2026-09-24

## Context

The Customer ride flow needs a current Trip state after creation, and Drivers
need a validated path for location updates. Realtime messages must not become a
second source of truth or bypass resource authorization. The project is still a
local modular monolith, so introducing a broker or independently deployed
gateway would add operational cost before the correctness boundary is proven.

## Decision

Use one authenticated raw WebSocket gateway at `/ws` inside the API process.

- Authenticate with the existing short-lived access token as the first message.
- Authorize every Trip subscription from PostgreSQL ownership/assignment data.
- Use a read-only composed snapshot query as the explicit realtime projection;
  Realtime never writes Trip, Dispatch, or Location tables.
- Send a fresh authoritative snapshot on subscription and reconnect.
- Relay committed Trip outbox rows by polling PostgreSQL.
- Route Driver location messages through the existing Location service.
- Use Trip aggregate versions so clients can discard stale updates.
- Expose process-local metrics to an authenticated Operator endpoint.

## Alternatives considered

- **Polling HTTP:** simpler, but less suitable for continuous status/location
  delivery and reconnect snapshot semantics.
- **Redis Pub/Sub or Kafka:** useful for multi-instance fanout later, but would
  add a delivery dependency and operational boundary before the MVP needs it.
- **WebSocket-owned business state:** rejected because disconnects and process
  restarts must not lose Trip or Location correctness.

## Consequences

The MVP has a small, testable realtime boundary with no broker dependency. The
trade-off is process-local connection state and no horizontal fanout. A future
multi-instance deployment must add a broker or gateway fanout layer, durable
consumer progress, and a deployment-specific failure/recovery design before
claiming high availability.
