# Acceptance Matrix

Status: Active
Last updated: 2026-09-24

This matrix is the final traceability source. `Tested` means automated evidence
has run locally. `Partial` means some evidence exists but the completion gate is
not closed. `Planned` means the requirement is accepted but evidence is absent.
Only a reviewed, reproducible result may be marked `Verified`.

## Ride and platform requirements

| Requirements | Capability                                                       | Primary implementation                      | Current evidence                                     | State   |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- | ------- |
| FR-01–02     | Authentication, sessions, roles, ownership                       | `identity`, guards and API filters          | Auth integration/unit tests                          | Tested  |
| FR-03        | Driver profile, Vehicle and eligibility                          | `driver` module                             | Auth/Driver integration coverage                     | Tested  |
| FR-04–05     | Validated monotonic Latest Location and freshness                | `location` and Dispatch query               | Dispatch integration coverage                        | Tested  |
| FR-06–07     | Fare Quote and idempotent Trip creation                          | `pricing`, `trip`                           | Pricing and Trip tests                               | Tested  |
| FR-08–10     | Candidate ranking, reservation, offers and one-winner acceptance | `dispatch`                                  | Dispatch unit/integration races                      | Tested  |
| FR-11        | Versioned Trip lifecycle                                         | `trip`, Dispatch commands                   | Lifecycle and integration tests                      | Tested  |
| FR-12–13     | Live Trip projection and reconnect snapshot                      | `realtime`, Trip HTTP snapshot, PWA         | Realtime tests; browser reconnect evidence missing   | Partial |
| FR-14        | Cancellation metadata and rules                                  | Trip lifecycle                              | Final contract/acceptance evidence required          | Planned |
| FR-15–16     | Final Fare and idempotent simulated Payment                      | `pricing`, `payment`, completion command    | Payment and completion integration tests             | Tested  |
| FR-17        | Customer and Driver Trip history                                 | Trip history API and PWA                    | Integration tests and web build                      | Tested  |
| FR-18        | Operator diagnostic actions and audit                            | API/PWA diagnostic surface                  | Full operator action evidence absent                 | Planned |
| NFR-01       | Retry and concurrency integrity                                  | Transactions, locks, constraints, receipts  | Targeted tests; required repeated gate remains       | Partial |
| NFR-02       | No secrets or real personal data                                 | Git policy, ignored env, synthetic fixtures | Final scan/history review required                   | Partial |
| NFR-03       | Accessible, map-independent core actions                         | PWA forms and design system                 | Automated/manual browser evidence absent             | Planned |
| NFR-04       | Correlation and attributable transitions                         | HTTP logger, transitions and outbox         | Cross-domain log review required                     | Partial |
| NFR-05       | Liveness and readiness                                           | Health controller and Compose checks        | Unit test and local Compose smoke                    | Tested  |
| NFR-06       | Deterministic clean migrations                                   | SQL migration runner                        | Empty-database final replay required                 | Partial |
| NFR-07       | Pinned reproducible build/run                                    | lockfile and Compose                        | Local deployment tested; clean-checkout gate remains | Partial |
| NFR-08–09    | Representative measured workload                                 | load tool                                   | Liveness-only baseline; business workload absent     | Planned |
| NFR-10       | Application rollback                                             | staging Compose and additive migrations     | Rehearsal evidence absent                            | Planned |

## Delivery requirements

| Requirement | Capability                                  | Primary implementation                             | Current evidence                                               | State   |
| ----------- | ------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- | ------- |
| L-01        | Idempotent parcel Delivery creation         | `delivery` API/repository                          | Delivery integration test; Customer UI absent                  | Partial |
| L-02        | Separate versioned aggregate                | Delivery tables, transitions and ADR 0009          | Migration and integration tests                                | Tested  |
| L-03        | Exclusive Driver across Trip and Delivery   | shared Driver work state plus Delivery reservation | Delivery contention tests; explicit cross-domain race remains  | Partial |
| L-04–05     | Arrival, custody, handoff and bounded proof | Delivery lifecycle commands and Driver Console     | Integration tests and web build; browser evidence absent       | Partial |
| L-06        | Rebuildable Customer/Driver status          | Delivery HTTP projections                          | Customer history and Driver projections exist; realtime absent | Partial |
| L-07        | Command idempotency                         | Delivery command receipts                          | Create/accept/custody/completion replay tests                  | Tested  |
| L-08        | Customer/Driver ownership privacy           | owner and assignment queries                       | Negative integration tests                                     | Tested  |

## Final evidence gates

| Gate                        | Required evidence                                              | Current state                                       |
| --------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| Static and automated check  | `npm run check` at final commit                                | Tested on current workspace; repeat at final commit |
| Browser Ride acceptance     | Customer and Driver complete one Ride, reconnect included      | Planned                                             |
| Browser Delivery acceptance | Customer and Driver complete one Delivery                      | Planned                                             |
| Concurrency stress          | Mandatory races with invariant queries and recorded iterations | Partial                                             |
| Representative benchmark    | Recorded business workload and resource profile                | Planned                                             |
| Security review             | Findings, remediation and validation                           | Planned                                             |
| Clean environment           | Install, empty migration, build and staging smoke              | Partial                                             |
| Recovery                    | Backup/restore and application rollback rehearsal              | Restore tested; rollback planned                    |
| Documentation review        | Contracts, status, limitations and evidence agree              | Active                                              |
| VPS deployment              | Named TLS/WSS environment and network review                   | Conditional on infrastructure                       |

The matrix is updated in the same change that adds or invalidates evidence. A
passing test name alone is not enough when the gate requires browser,
performance, recovery, or deployment evidence.
