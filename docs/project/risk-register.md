# Risk Register

Status: Active
Last updated: 2026-09-24

| ID   | Risk                                             | Impact   | Likelihood | Mitigation                                                                                               | Closure evidence                            |
| ---- | ------------------------------------------------ | -------- | ---------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| R-01 | Two Trips reserve the same Driver                | Critical | High       | Database transaction, row lock or compare-and-set, reservation TTL, unique constraints                   | Repeated concurrency test proves one winner |
| R-02 | Retried commands duplicate Trip or Payment state | Critical | High       | Required idempotency keys and persisted outcomes                                                         | Duplicate-request integration tests         |
| R-03 | Stale or forged GPS drives incorrect matching    | High     | High       | Coordinate validation, authenticated Driver, capture timestamp, freshness threshold, plausibility checks | Invalid/stale-location tests and audit logs |
| R-04 | WebSocket disconnect hides authoritative state   | High     | High       | WebSocket carries projections only; reconnect fetches an HTTP snapshot before resubscribing              | Reconnect E2E test                          |
| R-05 | Cache outage corrupts business state             | Critical | Medium     | PostgreSQL remains authoritative; define degraded behavior and rebuild cache                             | Redis-loss resilience test                  |
| R-06 | Premature service split blocks delivery          | High     | Medium     | Modular monolith and explicit extraction gates                                                           | Architecture review at every proposed split |
| R-07 | Scope expands before the ride slice works        | High     | High       | Milestone gates; logistics starts after M6 evidence                                                      | M0-M6 acceptance checklist complete         |
| R-08 | Secrets or personal data enter Git               | Critical | Medium     | Environment placeholders, local commit guard, CI secret scanning, synthetic data                         | Secret scan and history review              |
| R-09 | Performance claims exceed evidence               | High     | Medium     | Record hardware, dataset, duration, throughput, percentiles, errors, and limitations                     | Reproducible benchmark report               |
| R-10 | Demo VPS cannot support selected stack           | High     | Unknown    | Measure resources early; set limits; load-test staging; keep single-process fallback                     | Resource profile and staging benchmark      |
