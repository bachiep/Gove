# MVP Requirements

Status: Accepted
Last updated: 2026-09-24

## Product boundary

The MVP proves one complete ride lifecycle for three roles through a responsive web application. Customer and Driver flows are mobile-first; Operator workflows are desktop-first. Driver tracking is foreground-only in the PWA and must never be represented as reliable background tracking.

This scope is frozen for academic completion. Changes require an updated
requirement, acceptance scenario, and architecture decision when they alter a
domain or operational boundary. The separate parcel Delivery extension is
defined in [M7 logistics requirements](logistics-m7.md). The project-wide
completion claim is defined in
[Completion definition](../project/completion-definition.md).

## Functional requirements

| ID    | Requirement                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------ |
| FR-01 | A User can register, authenticate, refresh a session, and sign out.                                                      |
| FR-02 | Authorization enforces Customer, Driver, and Operator capabilities and resource ownership.                               |
| FR-03 | A Driver can maintain an eligible profile and Vehicle, then request allowed Driver Work State changes.                   |
| FR-04 | An authenticated Driver can submit validated, timestamped coordinates while the app is active.                           |
| FR-05 | The system marks Latest Location stale after a configurable freshness threshold and excludes it from matching.           |
| FR-06 | A Customer can request a Fare Quote for Pickup, Dropoff, and Service Type.                                               |
| FR-07 | A Customer can create one idempotent Trip from a valid, unexpired Fare Quote.                                            |
| FR-08 | Dispatch finds nearby Drivers who are available, eligible, and fresh enough for the Service Type.                        |
| FR-09 | Dispatch reserves at most one Driver for one active offer and expires the reservation with the offer.                    |
| FR-10 | A Driver can accept or reject a pending Trip Offer; concurrent acceptance produces exactly one valid assignment.         |
| FR-11 | Authorized actors can execute only valid Trip lifecycle transitions.                                                     |
| FR-12 | Customer and assigned Driver receive live semantic Trip updates; GPS telemetry is throttled separately.                  |
| FR-13 | A reconnecting client obtains an authoritative HTTP snapshot before applying newer live events.                          |
| FR-14 | Cancellation records actor, reason, timestamp, and the rule used; the MVP charges no cancellation fee.                   |
| FR-15 | Trip completion calculates a final Fare from the accepted pricing snapshot and observed demo inputs.                     |
| FR-16 | Payment simulation captures a completed Trip idempotently and exposes pending, successful, failed, and unknown outcomes. |
| FR-17 | Customer and Driver can view their own Trip history; an Operator can inspect a diagnostic timeline.                      |
| FR-18 | Operator actions require authorization, a reason, and an audit record.                                                   |

## Non-functional requirements

| ID     | Requirement                                                                                               | Initial evidence                                            |
| ------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| NFR-01 | Durable state remains correct under retries and concurrency.                                              | Idempotency and race-condition integration tests            |
| NFR-02 | Secrets and real personal data never enter Git or demo fixtures.                                          | Secret scan and fixture review                              |
| NFR-03 | Normal text meets WCAG AA contrast; all core actions are keyboard reachable and map-independent.          | Automated accessibility audit plus keyboard walkthrough     |
| NFR-04 | Every request has a correlation ID; every state transition is structured and attributable.                | Log assertions and Operator timeline                        |
| NFR-05 | Health endpoints separate process liveness from dependency readiness.                                     | Container health and dependency-failure tests               |
| NFR-06 | Database migrations are deterministic and tested from an empty database.                                  | CI migration job                                            |
| NFR-07 | The system can be built and run with pinned containers and documented commands.                           | Fresh-environment smoke test                                |
| NFR-08 | Performance is reported with p50, p95, p99, throughput, errors, resources, dataset, and configuration.    | Reproducible benchmark report; no unmeasured capacity claim |
| NFR-09 | The first benchmark supports at least 100 simulated Drivers with configurable GPS interval and Trip rate. | Load-generator run with recorded limitations                |
| NFR-10 | A previous known-good application image can be redeployed without reversing an incompatible migration.    | Staging rollback drill                                      |

## Core acceptance scenarios

1. Two concurrent Trips contend for one Driver; only one reservation succeeds.
2. Two acceptance requests target the same offer; one succeeds and later retries return the persisted result.
3. An expired offer cannot be accepted and releases the Driver safely.
4. A duplicate Trip creation key returns the original Trip without creating another.
5. A duplicate Payment capture key returns the original Payment Attempt.
6. Stale GPS is rejected for matching and visibly marked stale in the UI.
7. Customer A cannot read or mutate Customer B's Trip.
8. A disconnected client can reload `/trips/current` or `/deliveries/active` and resume from a monotonic version; Browser Harness proof remains an acceptance gate.
9. PostgreSQL unavailability never produces a false success response.
10. Redis unavailability cannot corrupt durable Trip, Driver, or Payment state.

## Out of scope for MVP

Real payments, background mobile tracking, traffic-aware routing, pooling, promotions, ratings, multi-stop rides, scheduled rides, and production high availability. Delivery fulfillment is being added as the separate M7 extension in [M7 logistics requirements](logistics-m7.md).
