# Testing Strategy

Status: Accepted
Last updated: 2026-09-24

Correctness evidence is organized around module interfaces and business invariants. Coverage is diagnostic, not a substitute for behavior tests.

## Test levels

| Level       | Purpose                                                                                                            | Representative evidence                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Unit        | Pure state machines, pricing, eligibility, ranking, authorization policy, and idempotency fingerprint              | Fast deterministic Vitest suites                           |
| Integration | PostgreSQL/PostGIS transactions, migrations, spatial queries, constraints, outbox, and optional Redis TTL behavior | Real container dependencies; no persistence mocks          |
| Contract    | REST/OpenAPI, WebSocket envelope, and durable event compatibility                                                  | Schema validation and compatibility checks                 |
| End-to-end  | Customer, Driver, and Operator behavior across HTTP, WebSocket, database, and UI                                   | Isolated seeded environment and browser tests              |
| Concurrency | Races around reservation, acceptance, cancellation, completion, payment, and event delivery                        | Repeated parallel commands plus database invariant queries |
| Resilience  | Dependency outage, restart, reconnect, delayed/duplicate messages, and stale location                              | Controlled fault scenarios with recovery assertions        |
| Security    | Authentication, ownership, role, rate, input, secret, and log-redaction behavior                                   | Negative tests, scans, and public-port review              |
| Performance | Measured demo workload and regression comparison                                                                   | Raw results plus summarized percentiles and resources      |

## Mandatory race scenarios

1. Two Trips contend for one available Driver.
2. Two Drivers accept offers for one Trip.
3. One Driver attempts to accept two Trips.
4. Acceptance races offer expiry.
5. Cancellation races acceptance, start, or completion.
6. Duplicate Trip creation uses the same key and payload.
7. Reusing a key with a different payload returns conflict.
8. Duplicate or out-of-order payment and domain events produce one business effect.
9. Older GPS arrives after newer GPS and cannot replace Latest Location.
10. Database commit succeeds while outbox publishing is unavailable.

CI runs at least 100 iterations for each deterministic race scenario; a pre-demo stress gate runs 1,000 iterations. Acceptance requires no duplicate assignment, duplicate capture, or invalid state transition.

An architecture test rejects imports of another module's repository or persistence adapter. Cross-module commands must use the owning module's interface; explicitly documented read-only projection queries, such as the Realtime Trip snapshot, may compose owner tables without writing them.

## Browser scenarios

- Customer and Driver use isolated sessions.
- Keyboard-only Customer booking succeeds without interacting with the map.
- Permission denial has a manual-location recovery path.
- Disconnect and reconnect restore the authoritative active Trip.
- Stale location is visibly different from live data.
- Live regions announce semantic state changes but not every GPS update.
- Viewports include 375, 768, 1024, and 1440 CSS pixels with reduced motion enabled in one pass.
- Console errors, failed network requests, and accessibility findings fail the verification gate unless explicitly accepted.

## Security priorities

- IDOR and resource ownership for Trip, Driver, Payment, and history.
- WebSocket authentication and subscription authorization.
- Replay protection for Trip creation, offer acceptance, and Payment capture.
- Server authority over Fare and lifecycle transitions.
- No public PostgreSQL or Redis in staging.
- No secrets, tokens, full coordinates, or personal data in logs.
- HTTP, GPS, and WebSocket rate and payload limits.

## Performance baseline

The first run is a demo baseline, not a production-capacity claim:

- 100 online Drivers sending GPS every 3 seconds.
- 20 concurrent Customers.
- 1 Ride Request per second through a closed-loop lifecycle.
- 2-minute warm-up and 15-minute steady state, repeated three times.
- Separate contention and reconnect runs.

Record p50, p95, and p99 for Trip creation, durable matching commit, GPS ingestion, and WebSocket propagation; also record throughput, categorized errors, CPU, memory, disk, database/cache metrics, commit SHA, versions, dataset, and configuration. After a baseline is accepted, unexplained p95 or throughput regression over 20% fails the gate.

## Evidence retention

Commit stable test code and concise human-readable reports. Raw logs containing secrets, personal data, local paths, or workflow provenance stay outside Git. Benchmark artifacts must be sanitized before inclusion.
