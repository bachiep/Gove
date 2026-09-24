# Realtime Trip and Delivery API

Status: Implemented and tested locally

Last updated: 2026-09-25

The realtime boundary is an authenticated WebSocket endpoint at `/ws`. It
delivers rebuildable Trip and Delivery snapshots, committed outbox events, and
current Driver location updates for active Trips and Deliveries. PostgreSQL remains the source of
truth; the gateway does not own Trip, Delivery, Dispatch, or Location state.

## Connection and authentication

The client connects to `ws(s)://<host>/ws` and must send an authentication
message as its first application message within five seconds:

```json
{ "type": "authenticate", "accessToken": "<access-token>" }
```

The server returns `authenticated` or an `error` and closes an invalid session.
The access token is the same short-lived bearer token used by the HTTP API.

After authentication, the gateway revalidates the same access token and
database-backed session at the existing 30-second heartbeat cadence. This
reuses the HTTP authentication boundary, including JWT expiry, refresh-session
revocation, and `authEpoch` changes. If revalidation fails, the server sends:

```json
{
  "type": "error",
  "code": "AUTH_REAUTH_REQUIRED",
  "message": "Realtime authentication expired or was revoked. Authenticate again."
}
```

It then closes the socket with WebSocket close code `1008` and reason
`AUTH_REAUTH_REQUIRED`. Revalidation is single-flight per connection, so a
slow database check cannot create concurrent checks on successive heartbeat
callbacks. Clients should treat this close like an authentication failure:
obtain a fresh access token through the normal refresh flow and establish a
new connection, while ordinary network closes retain the normal reconnect
path.

## Client messages

```json
{"type":"subscribe","tripIds":["<trip-id>"],"deliveryIds":["<delivery-id>"]}
{"type":"location","location":{"latitude":10.76,"longitude":106.68,"accuracyMeters":10,"source":"GPS","sequenceNumber":"42"}}
{"type":"ping"}
```

`subscribe` accepts one to 20 aggregate IDs across `tripIds` and `deliveryIds`.
Authorization is checked per Trip/Delivery for the Customer owner, the assigned
Driver, or a Driver with a pending/accepted Offer. A Driver may send `location`;
other roles receive `AUTH_FORBIDDEN`.

## Server messages

- `authenticated` confirms the actor and roles.
- `trip.snapshot` is sent after an authorized subscription and is the reconnect
  baseline. It includes Trip state/version, assignment Driver ID, completion
  metering/final fare when available, and the latest Driver location when
  available.
- `trip.event` relays a committed `trip.outbox_events` row with event ID,
  aggregate version, type, payload, and occurrence time. Completion payloads
  include observed metering and final fare.
- `delivery.snapshot` is the reconnect baseline for an authorized Delivery. It
  includes the Delivery state/version and assigned Driver ID when one exists.
- `delivery.event` relays a committed `delivery.outbox_events` row with event
  ID, aggregate version, type, payload, and occurrence time. Matching,
  assignment, custody, handoff, completion, and no-Driver outcomes write their
  event in the same transaction as the durable state transition.
- `driver.location` broadcasts a validated latest location to subscribers of the
  Driver's current Trip.
- `delivery.driver.location` broadcasts the same validated location projection
  to authorized subscribers of the Driver's current Delivery.
- `location.accepted`, `pong`, and `error` acknowledge commands or report a
  rejected message.

The gateway accepts at most 60 client messages per connection in ten seconds
and at most one accepted Driver location update every three seconds. The REST
location endpoint and WebSocket location command share the same process-local
Driver admission limiter; rejected writes return `429` over HTTP or
`LOCATION_RATE_LIMITED` over WebSocket.

Clients must treat the aggregate version as the ordering guard and may discard
an older snapshot or event. On reconnect, clients should authenticate again and
request a fresh snapshot before applying live events.

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
- Connections, metrics, message quotas, and GPS admission are process-local;
  there is no multi-instance fanout, broker, shared rate-limit store, durable
  consumer checkpoint, or horizontal high-availability design.
- Outbox relay errors are retried on the next poll; a durable consumer ledger and
  dead-letter workflow remain future work.
- The PWA reconnects by opening a new socket when its Trip view is mounted; an
  explicit exponential-backoff reconnect policy is not yet implemented.
