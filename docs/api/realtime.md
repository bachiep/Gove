# Realtime Trip API

Status: Implemented and tested locally

Last updated: 2026-09-24

The realtime boundary is an authenticated WebSocket endpoint at `/ws`. It
delivers rebuildable Trip snapshots, committed Trip outbox events, and current
Driver location updates. PostgreSQL remains the source of truth; the gateway
does not own Trip, Dispatch, or Location state.

## Connection and authentication

The client connects to `ws(s)://<host>/ws` and must send an authentication
message as its first application message within five seconds:

```json
{ "type": "authenticate", "accessToken": "<access-token>" }
```

The server returns `authenticated` or an `error` and closes an invalid session.
The access token is the same short-lived bearer token used by the HTTP API.

## Client messages

```json
{"type":"subscribe","tripIds":["<trip-id>"]}
{"type":"location","location":{"latitude":10.76,"longitude":106.68,"accuracyMeters":10,"source":"GPS","sequenceNumber":"42"}}
{"type":"ping"}
```

`subscribe` accepts at most 20 Trip IDs. Authorization is checked per Trip for
the Customer owner, the current Driver, or a Driver with a pending/accepted
Offer. A Driver may send `location`; other roles receive `AUTH_FORBIDDEN`.

## Server messages

- `authenticated` confirms the actor and roles.
- `trip.snapshot` is sent after an authorized subscription and is the reconnect
  baseline. It includes Trip state/version and the latest Driver location when
  available.
- `trip.event` relays a committed `trip.outbox_events` row with event ID,
  aggregate version, type, payload, and occurrence time.
- `driver.location` broadcasts a validated latest location to subscribers of the
  Driver's current Trip.
- `location.accepted`, `pong`, and `error` acknowledge commands or report a
  rejected message.

Clients must treat Trip version as the ordering guard and may discard an older
snapshot or event. On reconnect, clients should authenticate again and request
a fresh snapshot before applying live events.

## Current delivery implementation

The local gateway polls the PostgreSQL transactional outbox every 250 ms and
broadcasts matching events to in-process WebSocket connections. It uses an
in-memory connection registry and the existing Location service for validated
location writes. `GET /api/v1/realtime/metrics` exposes active connections,
authenticated connections, subscriptions, accepted location messages, and
relayed outbox events to an authenticated `OPERATOR`.

## Explicit limitations

- This is a tested local modular-monolith boundary, not a production capacity
  claim.
- Connections and metrics are process-local; there is no multi-instance fanout,
  broker, durable consumer checkpoint, or horizontal high-availability design.
- Outbox relay errors are retried on the next poll; a durable consumer ledger and
  dead-letter workflow remain future work.
- The PWA reconnects by opening a new socket when its Trip view is mounted; an
  explicit exponential-backoff reconnect policy is not yet implemented.
