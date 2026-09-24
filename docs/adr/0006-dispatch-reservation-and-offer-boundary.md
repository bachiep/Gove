---
status: accepted for the M3 implementation boundary
---

# Keep Driver reservation and offer acceptance inside the PostgreSQL transaction boundary

Dispatch must prevent two Trips from assigning the same Driver while preserving
the existing Trip lifecycle, PostgreSQL source-of-truth, and transactional outbox
decisions. The proposed design keeps Dispatch ownership of Driver Work State,
Driver Reservation, Trip Offer, and Assignment, while a transaction coordinator
atomically coordinates those records with the Trip version transition. The
Reservation and Offer share one configurable expiry deadline; only an accepted
Offer creates an Assignment and moves the Trip to `DRIVER_TO_PICKUP`.

## Decision

Use PostgreSQL row locks, unique constraints, state/version guards, and one
transaction for reservation, offer outcome, acceptance, and the related Trip
transition. Candidate queries and Redis projections are advisory inputs only. The
transaction that commits a business outcome also writes the producing module's
outbox event. Consumers and retry handlers are idempotent, and no broker or Redis
lock is a correctness dependency for the MVP.

The MVP sends one offer at a time. Rejecting or expiring an offer releases its
Reservation before the next candidate is attempted. Acceptance wins only when the
transaction observes a still-pending, unexpired Offer, an active matching
Reservation, and the expected Trip version.

## Considered options

- **Redis lock as the authority:** rejected. It introduces a second correctness
  system, can diverge from durable state, and does not atomically update Trip,
  Offer, Reservation, and Assignment.
- **Optimistic application-only checks:** rejected. A read followed by independent
  writes leaves a race between two Trips selecting one Driver.
- **Parallel offers or an external auction:** deferred. They may improve utilization
  later, but increase contention, fairness policy, and customer-facing failure
  modes before the single-offer path is verified.
- **Independent Dispatch service with a broker now:** deferred. The current modular
  monolith and transactional outbox preserve the boundary without adding network,
  distributed-transaction, and broker operations to the MVP.

## Consequences

- Assignment correctness depends on PostgreSQL transaction behavior, constraints,
  and a consistent lock order; these require integration and concurrency tests.
- Dispatch retries can safely replay outbox delivery and command submissions only
  when durable command receipts and idempotent consumers are implemented.
- Candidate freshness and ranking remain configurable policy, not capacity or
  latency guarantees. The initial design defaults are documented in Vertical Slice
  03 and must be validated before they are treated as operational settings.
- The system gains a clear extraction seam: Dispatch may later own its datastore
  and publish versioned contracts, but extraction requires equivalent atomicity,
  idempotency, and failure evidence.

## Status boundary

The schema, ranking, reservation transaction, concurrent acceptance behavior,
reject/reassignment commands, expiry worker, expiry repair, and related Trip
outbox writes are implemented and tested locally. Each expired Offer advances
the Trip version even though it remains in `MATCHING`, so every durable expiry
and reassignment attempt has a distinct aggregate version. Asynchronous outbox
consumption and performance characteristics remain unverified or planned.
