# Vertical Slice 02 — Quote to Durable Ride Request

Status: Implemented and tested locally
Last updated: 2026-09-24

## Objective

Allow an authenticated Customer to obtain an expiring Fare Quote and create exactly one `REQUESTED` Trip from it. This milestone proves pricing provenance and retry-safe Trip creation; it does not start dispatching.

## Scope

- Customer-only quote and Trip creation commands.
- Manual pickup and dropoff labels plus coordinates inside a synthetic inner-Hanoi demo zone.
- A routing-provider estimate with explicit coordinate fallback provenance.
- Versioned service types and rate cards, amounts in integer VND units, and bounded surge.
- Server-side quote expiry, single-use quote consumption, Trip version `0`, creation transition, and transactional outbox record.
- REST contracts and a responsive PWA flow that accurately displays an estimated quote and `REQUESTED` result.

## Explicitly excluded

Maps, geocoding, road-network routing, live Driver availability, matching, driver assignment, ETA claims, cancellation command, payment, and real addresses. The UI must never imply these exist.

## Consistency boundary

`POST /trips` is one PostgreSQL transaction:

1. Lock or replay the Customer's idempotency receipt.
2. Lock the Fare Quote and verify owner, active status, and server-time expiry.
3. Create one `REQUESTED` Trip with a copied immutable quote snapshot.
4. Mark the quote `CONSUMED`, append the version-0 creation transition, persist the command receipt, and write `trip.created` to the Trip outbox.

The unique `trip.fare_quote_id` constraint makes quote consumption single-use even if two requests race. A duplicate key with the same request replays its safe response; a different request is rejected.

## Initial demo policy

The service area is a synthetic inner-Hanoi coordinate rectangle bounded by latitude `20.9800..21.1000` and longitude `105.7600..105.9000`; labels are user-entered demo text and are not verified addresses. A quote rejects coordinates outside this zone or identical pickup/dropoff points. When OSRM is unavailable, the API returns a clearly marked coordinate fallback estimate rather than claiming road routing.

Initial service types are `MOTORBIKE_STANDARD` and `CAR_STANDARD`. Each has an idempotently seeded, immutable MVP rate-card version. The seed expresses policy for an academic demo only; it is not a market-price claim.

## Acceptance evidence

- Pricing unit tests cover integer arithmetic, rounding, bounded surge, invalid values, and snapshot isolation.
- HTTP integration tests cover customer authorization, invalid zone/identical points, quote expiry, quote ownership, duplicate Trip creation, and concurrent consumption of one quote.
- Migration re-execution succeeds; no credential or personal demo identity is seeded.
- The customer PWA flow was browser-tested locally from registration through sign-in, quote creation, and `REQUESTED` Trip creation.
- The flow was checked at a 375px viewport with accessibility snapshots, linked field validation, exact quote expiry, and no console errors or warnings.
- GitHub CI execution and an authenticated automated browser test in CI remain unverified; local browser evidence is not presented as deployment evidence.
