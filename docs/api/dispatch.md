# Dispatch, Location, and Driver Acceptance API

Status: Partially implemented and tested locally
Last updated: 2026-09-24

These endpoints implement the M3 correctness boundary in the modular monolith. PostgreSQL owns the latest location projection, Driver Work State, Reservation, Trip Offer, and Trip transition. The M4 WebSocket gateway now delivers rebuildable Trip snapshots and committed outbox events; it does not own any of these business states.

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

## Reject an offer

`POST /api/v1/dispatch/offers/:offerId/reject` requires the offered Driver bearer token and an `Idempotency-Key`. The endpoint has no request body. One PostgreSQL transaction locks the Offer, Reservation, Work State, and Trip, then commits:

- Offer `PENDING → REJECTED` with `DRIVER_REJECTED` resolution metadata;
- Reservation `ACTIVE → RELEASED`;
- Driver Work State `RESERVED → AVAILABLE`;
- a `dispatch.offer.rejected` outbox event;
- one bounded reassignment candidate, if a different fresh eligible Driver is available.

The response is `{ rejectedOffer, reassignedOffer }`. Rejection increments the Trip aggregate version with a recorded `MATCHING → MATCHING` command. A replacement Offer is attempt `n + 1`, keeps the Trip in `MATCHING`, and is emitted as `dispatch.offer.reassigned` so the outbox uniqueness invariant remains valid at the new Trip version. The Driver who rejected the Offer is excluded from that immediate candidate search. If no candidate exists, the Trip moves to `NO_DRIVER_AVAILABLE` with one further versioned transition, and the response reflects that final version.

Concurrent reject requests are serialized by a PostgreSQL advisory transaction lock and the Offer row lock. A duplicate request with the same key replays the stored `REJECT_OFFER` receipt; a different key after resolution returns `OFFER_ALREADY_RESOLVED`. A rejected Offer cannot subsequently be accepted.

## Expiry worker

The Dispatch module runs a bounded local sweep every five seconds. It selects
pending Offers whose shared Reservation/Offer deadline has passed, applies the
pure expiry policy, releases the Driver exactly once, writes
`dispatch.offer.expired`, and attempts one replacement candidate. If no fresh
candidate exists, the Trip moves to `NO_DRIVER_AVAILABLE`. The worker is
best-effort process-local and the database transaction remains authoritative.

## Current limitations

- Reassignment is currently one bounded synchronous retry; a general retry policy and explicit Driver rejection reason are not implemented.
- Driver approval is still an operator/database setup concern; there is no operator approval API.
- The customer PWA displays the current Trip state, Trip version, and WebSocket connection status. A Driver Offer is shown as pending when the matching response includes one; a full Driver-facing Offer inbox is not implemented.
- Freshness, offer TTL, radius, and candidate limits are local policy constants; no capacity or latency claim is made.
