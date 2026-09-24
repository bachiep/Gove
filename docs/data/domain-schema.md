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
| `trip`     | Trips, cancellations, state transitions, command receipts, and outbox events                      |
| `location` | one Latest Location row per Driver with capture-time and geography indexes                        |
| `dispatch` | shared Driver work state, Trip reservations, Trip Offers, and Ride assignments                    |
| `payment`  | Payment Attempts, provider selection, command receipts, and settlement outbox events              |
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
- `trip.cancellations` permits exactly one cancellation audit record per Trip;
  it records the actor, role, reason code/detail, applied rule, correlation ID,
  and cancellation time. Database checks constrain actor role, reason codes,
  rule codes, nonblank correlation IDs, and the allowed reason-detail length.
- Customer cancellation records its Trip state transition, cancellation audit,
  `CANCEL_TRIP` command receipt, and `trip.cancelled` outbox event in one
  transaction. Matching/assignment cleanup is implemented in the repository
  but remains pending dedicated integration and race evidence.
- Trip completion, payment capture, Delivery custody/handoff, assignment
  closure, Driver release, transition history, receipts, and outbox records are
  committed within their documented transaction boundaries.

## Migration sequence

| Migration | Capability                                               |
| --------- | -------------------------------------------------------- |
| `0001`    | Schemas and PostGIS extension baseline                   |
| `0002`    | Identity authentication and refresh sessions             |
| `0003`    | Driver profile and Vehicle                               |
| `0004`    | Pricing and Trip write model                             |
| `0005`    | Latest Location and Trip dispatch                        |
| `0006`    | Trip completion, assignment, and Payment                 |
| `0007`    | Delivery aggregate foundation                            |
| `0008`    | Delivery dispatch and shared Driver work state           |
| `0009`    | Delivery custody and proof                               |
| `0010`    | Operator diagnostic audit action                         |
| `0011`    | Ride cancellation audit model                            |
| `0012`    | Driver onboarding approval audit                         |
| `0013`    | Payment provider baseline (`SIMULATOR`, `MOMO`, `SEPAY`) |
| `0014`    | Operator onboarding mutation idempotency receipts        |

Migration `0013-payment-provider-baseline.sql` adds the `provider` column to
`payment.payment_attempts` and constrains it to `SIMULATOR`, `MOMO`, or
`SEPAY`. The current adapter behavior is intentionally asymmetric:
`SIMULATOR` can produce deterministic test outcomes, while `MOMO` and
`SEPAY` only create a `PENDING` attempt until API, QR, webhook, signature
verification, and reconciliation flows are implemented and verified.

Migration `0014-operator-onboarding-idempotency.sql` adds transactional
receipts for Operator Driver-profile and Vehicle approve/reject commands.

Migrations are forward-only and additive in the current scope. Empty-database
replay is a final acceptance gate. Application rollback must use a schema-
compatible image; database rollback never means deleting the volume.

The migration runner owns `public.schema_migrations` and serializes migration
runs with a PostgreSQL advisory lock; individual migration files do not manage
the ledger.
