# Fare Quote and Ride Request API

Status: Implemented and tested locally
Last updated: 2026-09-25

Both commands require a Customer bearer token and an `Idempotency-Key` with 8–128 characters. The server owns distance estimation, quote expiry, pricing, and Trip state; clients do not submit an amount, duration, or lifecycle state.

## `POST /api/v1/pricing/fare-quotes`

Creates an `ACTIVE` Fare Quote from `pickup`, `dropoff`, and `serviceType`. Each location has a demo label, latitude, and longitude. Coordinates must lie inside the configured synthetic demo rectangle and points must differ.

The response includes a quote ID, service type, normalized input locations, estimated distance/duration, currency, estimated total, server expiry, and an optional `route` projection. `route.geometry` is GeoJSON-compatible `LineString` data with provider/version/timestamp provenance. When `route.usedFallback` is `true`, the geometry is only a coordinate estimate and must not be presented as a road route. The response does not include a Driver, live ETA, or final fare. Older idempotency receipts may omit `route`; clients must retain the coordinate fallback label. A matching idempotency retry replays the same quote; reusing its key with changed input returns `409 IDEMPOTENCY_KEY_REUSED`.

## `POST /api/v1/trips`

Accepts `{ "fareQuoteId": "uuid" }` and creates one Trip in `REQUESTED` state. The command locks the quote and verifies that it belongs to the authenticated Customer, is active, and has not expired. It copies the quote snapshot into the Trip, marks the quote consumed, records the initial transition, and writes `trip.created` to the outbox in one transaction.

A matching retry replays the same Trip response. The command serializes creation
per Customer and rejects a second active Trip in `REQUESTED`, `MATCHING`,
`DRIVER_TO_PICKUP`, `AT_PICKUP`, or `IN_PROGRESS` with `409
ACTIVE_TRIP_EXISTS`. A competing command against an already consumed quote
returns `409 FARE_QUOTE_ALREADY_CONSUMED`; expired quotes return `422
FARE_QUOTE_EXPIRED`; a quote not owned by the Customer is not exposed.

## `GET /api/v1/trips/current`

Returns the authenticated Customer's newest non-terminal Trip, including its
pickup and dropoff locations, or `null` when no active Trip exists. The
endpoint is a durable resume source after a page refresh; it does not start
matching or replay a command. If old development data contains more than one
active Trip, the response is deterministic (newest `created_at`, then ID),
while new Trip creation prevents that state from being created.

## `POST /api/v1/trips/:tripId/cancel`

Cancels an eligible Trip owned by the authenticated Customer. The command
requires an `Idempotency-Key` with 8–128 characters; `X-Correlation-Id` is
optional. It accepts the following request body:

```json
{
  "reasonCode": "CHANGE_OF_PLANS",
  "reasonDetail": "optional except when reasonCode is OTHER"
}
```

`reasonCode` is one of `CHANGE_OF_PLANS`, `DRIVER_DELAY`,
`DRIVER_REQUESTED_CANCELLATION`, `SAFETY_CONCERN`, `VEHICLE_ISSUE`, or `OTHER`.
For `OTHER`, `reasonDetail` is required after trimming and must contain 3–240
characters. For the other codes it is optional and, if supplied, has the same
length constraint.

The endpoint returns `201` with the cancelled Trip and a PII-minimized
`cancellation` summary: `cancelledByRole`, `reasonCode`, `ruleCode`, and
`cancelledAt`. It returns `404 TRIP_NOT_FOUND` when the Trip is not owned by
the Customer, `409 TRIP_CANCELLATION_NOT_ALLOWED` for a disallowed state, and
`409 IDEMPOTENCY_KEY_REUSED` when the same key has a different request
fingerprint. A matching replay returns the stored response.

The currently implemented Customer policy permits `REQUESTED`, `MATCHING`,
`DRIVER_TO_PICKUP`, and `AT_PICKUP`; it rejects `IN_PROGRESS` and terminal
states. The command has no cancellation fee and does not create or change a
payment attempt. Its transaction includes a versioned Trip transition,
cancellation audit record, command receipt, and `trip.cancelled` outbox event.

The repository contains cleanup code for pending matching records and active
assignments, but those scenarios have not yet been verified by dedicated
integration or race tests. Driver and Operator cancellation endpoints,
Customer/Driver frontend flows, browser acceptance, and realtime cancellation
acceptance remain pending.

## Verified locally

The M2 HTTP suite covers quote replay, idempotent concurrent Trip creation,
same-Customer active-Trip rejection, competing quote consumption, and
outside-service-area rejection. The pricing unit suite covers deterministic
integer calculation, rounding, surge bounds, invalid inputs, and snapshot
isolation. The Trip integration suite also covers Customer cancellation from
`REQUESTED` plus idempotent replay; it does not yet cover cleanup or concurrent
cancellation scenarios.
