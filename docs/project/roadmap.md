# Project Roadmap

Status: Accepted
Last updated: 2026-09-24

Each milestone exits only when its acceptance evidence is recorded. Dates are intentionally omitted until delivery capacity and the demo deadline are known.

Current work: **M6 hardening, M7 logistics closure, and M7.1 map foundation.** M0–M5 are
implemented and tested locally. M6 has local rate limits, a load-tool baseline,
a locally verified Compose deployment, and a clean-database restore drill. M7
has a separate Delivery aggregate, exclusive cross-domain Driver work state,
offer acceptance and expiry, custody/proof lifecycle, Customer history API, and
Driver Console workflow. A local synthetic browser run now covers the full
Customer-and-Driver custody path through `DELIVERED`; browser GPS, reconnect,
and external deployment evidence remain open. Remaining work is governed by the
[completion plan](completion-plan.md).

| Milestone                        | Outcome                                                                                                      | Exit evidence                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 Foundation                    | Repository, documentation baseline, monorepo, CI, and local infrastructure                                   | Clean build; lint and unit test commands; PostgreSQL/PostGIS health check; documentation review                                                                                       |
| M1 Identity and Driver Profile   | Registration, login, roles, Driver profile, Vehicle, and authorization                                       | Auth integration tests; ownership tests; secret scan; synthetic browser identities; rate-limit evidence                                                                               |
| M2 Ride Request and Pricing      | Validated Pickup/Dropoff, Service Type, expiring Fare Quote, idempotent Trip creation, and customer PWA flow | Contract tests; pricing unit tests; duplicate-request test; migration replay; local browser smoke evidence                                                                            |
| M3 Dispatch and Acceptance       | Nearby eligible candidates, exclusive reservation, offer expiry, accept/reject, and no-driver result         | Dispatch integration tests cover reservation, acceptance, rejection/reassignment, expiry worker, and stale-driver outcome                                                             |
| M4 Real-Time Trip                | Authenticated WebSocket, Driver location updates, reconnect snapshot, and live Trip status                   | Realtime integration tests; Web build; clean-tab browser smoke; process-local metrics endpoint                                                                                        |
| M5 Completion and Settlement     | Trip completion, final Fare, idempotent Payment simulation, and history                                      | State-transition tests; duplicate capture test; customer/driver history integration; web production build                                                                             |
| M6 Hardening and Demo Deployment | Rate limits, observability, load generator, backup/restore, deploy and rollback                              | In progress: representative benchmark, security review, browser staging smoke and rollback rehearsal remain                                                                           |
| M7 Logistics Extension           | Separate Delivery model with pickup, recipient, parcel, proof, and delivery lifecycle                        | Implemented locally: Customer PWA, rebuildable realtime status, backend lifecycle, Driver Console, and local synthetic browser custody flow; GPS/reconnect/external deployment remain |
| M7.1 Map Foundation              | Customer map projection for pickup/dropoff with a provider-safe fallback                                     | Implemented locally: Leaflet map host, coordinate markers, preview line, attribution, responsive layout, and tile failure fallback; road routing, live Driver marker, and ETA remain  |
| M8 Final Verification            | Frozen-scope acceptance, evidence review, reproducible demo and handover                                     | Acceptance matrix closed; clean-checkout check; demo runbook pass; known limitations and final status reviewed                                                                        |

VPS, public DNS, and TLS/WSS are a deployment profile, not a hidden
requirement for local academic completion. When infrastructure is supplied,
they are required before the project may claim `Deployed`; otherwise the final
claim remains `Verified locally`.

## Architecture evolution gates

A module may become an independently deployed service only when at least one gate is demonstrated: materially different scaling, independent release ownership, isolation of a proven failure domain, or a security boundary that cannot be enforced in-process. Extraction requires contract tests, an owned datastore plan, and an operational rollback plan.
