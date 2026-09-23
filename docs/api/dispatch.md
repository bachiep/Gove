# Dispatch, Location, and Driver Acceptance API

Status: Partially implemented and tested locally
Last updated: 2026-09-24

These endpoints implement the M3 correctness boundary in the modular monolith. PostgreSQL owns the latest location projection, Driver Work State, Reservation, Trip Offer, and Trip transition. Redis, WebSocket delivery, and an asynchronous outbox consumer are not required for the current local path.

## Driver location

`PUT /api/v1/drivers/me/location` requires a Driver bearer token. The body contains latitude, longitude, accuracy, optional device metadata, a client capture timestamp, and a monotonic sequence number. The Location module accepts only valid coordinates and prevents an older sequence/timestamp from replacing the latest projection.

The database records both `captured_at` and server `received_at`. Dispatch uses server receipt freshness; a client timestamp cannot make stale telemetry appear current.

## Driver work state

`PUT /api/v1/drivers/me/work-state` accepts `AVAILABLE` or `OFFLINE`. A Driver can become `AVAILABLE` only with an approved profile and one approved selected vehicle. A Driver with a Reservation, accepted Assignment, or active Trip cannot be switched by this command.

## Start matching

`POST /api/v1/dispatch/trips/:tripId/match` requires a Customer bearer token and an `Idempotency-Key`. The Customer must own the Trip. The current local implementation synchronously performs one bounded matching attempt:

1. Move `REQUESTED` to `MATCHING` in a Trip versioned transaction.
2. Generate fresh nearby candidates for the Trip service type.
3. Rank by distance, freshness age, and Driver ID.
4. Lock/recheck an available Driver, create one Reservation and one pending Offer, or move the Trip to `NO_DRIVER_AVAILABLE`.
5. Persist the response in the Trip command-receipt table for an exact idempotent replay.

The endpoint is a deterministic local trigger for this milestone. Production-style consumption of `trip.created` from an outbox worker is not yet implemented.

## Accept an offer

`POST /api/v1/dispatch/offers/:offerId/accept` requires the offered Driver bearer token and an `Idempotency-Key`. One PostgreSQL transaction locks the Offer, Reservation, Work State, and Trip, verifies the shared expiry and expected Trip version, then commits:

- Offer `PENDING → ACCEPTED`;
- Reservation `ACTIVE → COMMITTED`;
- Driver Work State `RESERVED → TO_PICKUP`;
- Trip `MATCHING → DRIVER_TO_PICKUP`;
- the versioned transition and `trip.driver.assigned` outbox event.

Concurrent acceptance requests with the same key replay the committed response. A late acceptance expires the Offer, releases the Reservation, returns the Driver to `AVAILABLE`, and returns `OFFER_EXPIRED`.

## Current limitations

- Reject and explicit reassignment commands are designed but not implemented.
- An expiry/retry worker is not implemented; the acceptance path repairs an overdue Offer when it is touched.
- Driver approval is still an operator/database setup concern; there is no operator approval API.
- The customer PWA does not yet display live Offer or Driver status.
- Freshness, offer TTL, radius, and candidate limits are local policy constants; no capacity or latency claim is made.
