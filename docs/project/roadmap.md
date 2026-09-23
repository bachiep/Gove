# Project Roadmap

Status: Accepted
Last updated: 2026-09-24

Each milestone exits only when its acceptance evidence is recorded. Dates are intentionally omitted until delivery capacity and the demo deadline are known.

Current milestone: **M3 Dispatch and Acceptance — partially implemented and tested locally.** M2 remains complete locally. M3 now has location ingestion, freshness filtering, deterministic ranking, exclusive Reservation, Offer creation, idempotent matching replay, concurrent acceptance, expiry repair, and no-fresh-driver evidence. Reject/reassignment, the expiry worker, asynchronous outbox consumption, and realtime UI remain.

| Milestone                        | Outcome                                                                                                      | Exit evidence                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| M0 Foundation                    | Repository, documentation baseline, monorepo, CI, and local infrastructure                                   | Clean build; lint and unit test commands; PostgreSQL/PostGIS health check; documentation review            |
| M1 Identity and Driver Profile   | Registration, login, roles, Driver profile, Vehicle, and authorization                                       | Auth integration tests; ownership tests; secret scan; synthetic browser identities; rate-limit evidence    |
| M2 Ride Request and Pricing      | Validated Pickup/Dropoff, Service Type, expiring Fare Quote, idempotent Trip creation, and customer PWA flow | Contract tests; pricing unit tests; duplicate-request test; migration replay; local browser smoke evidence |
| M3 Dispatch and Acceptance       | Nearby eligible candidates, exclusive reservation, offer expiry, accept/reject, and no-driver result         | Current subset tests pass; reject/reassignment, expiry worker, and full M3 acceptance evidence remain      |
| M4 Real-Time Trip                | Authenticated WebSocket, driver location updates, reconnect snapshot, and live Trip status                   | Gateway integration tests; stale-location test; reconnect E2E test; active-connection metrics              |
| M5 Completion and Settlement     | Trip completion, final Fare, idempotent Payment simulation, and history                                      | State-transition tests; duplicate capture test; customer/driver history E2E                                |
| M6 Hardening and Demo Deployment | Rate limits, observability, load generator, backup/restore, TLS, deploy and rollback                         | Security review; benchmark report; restore drill; staging smoke test; rollback drill                       |
| M7 Logistics Extension           | Separate Delivery model with pickup, recipient, parcel, proof, and delivery lifecycle                        | Domain comparison; new ADRs; delivery vertical-slice tests without changing Trip semantics                 |

## Architecture evolution gates

A module may become an independently deployed service only when at least one gate is demonstrated: materially different scaling, independent release ownership, isolation of a proven failure domain, or a security boundary that cannot be enforced in-process. Extraction requires contract tests, an owned datastore plan, and an operational rollback plan.
