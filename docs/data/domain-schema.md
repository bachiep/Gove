# Domain Data Schema

Status: Implemented
Last updated: 2026-09-24

PostgreSQL 17 with PostGIS is the durable source of truth. SQL migrations under
`infra/postgres/migrations` are authoritative for column-level details; this
document records ownership, purpose, and critical invariants.

## Schema ownership

| Schema     | Tables and responsibility                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `pricing`  | Service Types, versioned rate cards, immutable Fare Quotes, and command receipts                  |
| `trip`     | Trips, state transitions, command receipts, and outbox events                                     |
| `location` | one Latest Location row per Driver with capture-time and geography indexes                        |
| `dispatch` | shared Driver work state, Trip reservations, Trip Offers, and Ride assignments                    |
| `payment`  | Payment Attempts, command receipts, and settlement outbox events                                  |
| `delivery` | Deliveries, transitions, receipts, outbox, reservations, offers, assignments, and Delivery Proofs |

Identity and Driver tables are documented separately in
[Identity and Driver data ownership](identity-driver-schema.md).

## Critical persistence invariants

- A command idempotency key is scoped to its actor/operation and stores the
  request fingerprint plus durable result; a different payload conflicts.
- Aggregate versions increase with committed Trip or Delivery state changes.
- Partial unique indexes permit at most one active reservation or assignment
  for a Driver and at most one active reservation/assignment for an aggregate.
- `dispatch.driver_work_states` carries the active Trip or Delivery binding;
  constraints prevent both bindings from being active simultaneously.
- Latest Location rejects an older capture time from replacing a newer one and
  uses PostGIS geography plus freshness indexes for candidate lookup.
- Fare calculation uses the immutable accepted quote/rate snapshot rather than
  mutable current pricing.
- Trip completion, payment capture, Delivery custody/handoff, assignment
  closure, Driver release, transition history, receipts, and outbox records are
  committed within their documented transaction boundaries.

## Migration sequence

| Migration | Capability                                     |
| --------- | ---------------------------------------------- |
| `0001`    | Schemas and PostGIS extension baseline         |
| `0002`    | Identity authentication and refresh sessions   |
| `0003`    | Driver profile and Vehicle                     |
| `0004`    | Pricing and Trip write model                   |
| `0005`    | Latest Location and Trip dispatch              |
| `0006`    | Trip completion, assignment, and Payment       |
| `0007`    | Delivery aggregate foundation                  |
| `0008`    | Delivery dispatch and shared Driver work state |
| `0009`    | Delivery custody and proof                     |

Migrations are forward-only and additive in the current scope. Empty-database
replay is a final acceptance gate. Application rollback must use a schema-
compatible image; database rollback never means deleting the volume.

The migration runner owns `public.schema_migrations` and serializes migration
runs with a PostgreSQL advisory lock; individual migration files do not manage
the ledger.
