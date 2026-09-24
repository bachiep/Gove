# Completion Plan

Status: Active
Last updated: 2026-09-25

This is the ordered engineering path from the current repository state to the
completion definition. It contains product and verification work only; it is
not an activity log.

## Current baseline

- M0–M5 Ride capabilities are implemented and tested locally.
- M6 local Compose, rate limiting, a liveness load-tool baseline, a bounded
  closed-loop no-approved-Driver smoke report, and an empty migration replay
  through the current `0014` baseline exist. The historical clean restore drill
  covers the preceding `0013` baseline; a current-baseline backup/restore and
  final release-commit recovery evidence remain open.
- M7 Delivery backend dispatch and custody lifecycle plus Driver Console are
  implemented and tested locally.
- M7.1 Operator onboarding idempotency, Fare Quote routing provenance, and
  truthful route labels are implemented and tested locally.
- Customer Delivery creation/status UI and Delivery realtime are implemented
  locally. Representative load evidence, browser E2E, security closure, and
  rollback evidence remain.

## Workstream 1 — Close the Delivery product slice

Deliver:

1. Browser acceptance for create, accept, custody, handoff, and final Customer
   status.

Exit gate: L-01 through L-08 are tested, the Customer and Driver browser path
passes, and Delivery docs/contracts match runtime behavior.

## Workstream 2 — Close Ride verification gaps

Deliver:

1. Confirm or implement the documented cancellation path and metadata.
2. Add browser E2E for the full Ride lifecycle and reconnect behavior.
3. Exercise mandatory race scenarios repeatedly and query database invariants
   after contention.
4. Verify dependency-failure behavior.
5. Add browser acceptance evidence for the Operator diagnostic/audit path
   required by FR-18.
6. Keep `SIMULATOR` as the verified test provider; treat `MOMO` and `SEPAY`
   as `PENDING` integration baselines until sandbox API, QR, webhook,
   signature, and reconciliation evidence exists.

Exit gate: all MVP functional requirements and core acceptance scenarios have
named evidence in the acceptance matrix.

## Workstream 3 — Security and observability closure

Deliver:

1. Review IDOR, role boundaries, WebSocket subscription authorization, replay,
   payload/rate limits, secret handling, logs, and published ports.
2. Ensure correlation identifiers and attributable lifecycle logs cover Trip,
   Delivery, Dispatch, and Payment.
3. Expose and record useful matching, location, realtime, and error metrics for
   the single-process demo.

Exit gate: no unresolved critical/high finding; known single-instance limits
are documented and observable failures can be diagnosed from retained data.

## Workstream 4 — Representative performance evidence

Deliver the workload defined in the testing strategy: 100 online Drivers, GPS
updates every three seconds, 20 Customers, one closed-loop Ride request per
second, warm-up, sustained run, contention run, and reconnect run. Record
latency percentiles, throughput, errors, CPU, memory, database metrics, commit,
versions, dataset, and limitations.

Exit gate: the workload is reproducible and completes without a correctness
violation. There is no fixed marketing latency target; unexplained regressions
from the accepted baseline require investigation.

## Workstream 5 — Reproducible release and handover

Deliver:

1. Clean-checkout install, migration, check, build, and local staging smoke.
2. Current-baseline backup/restore repeat and prior-application-image rollback
   rehearsal.
3. Demo runbook execution with synthetic identities and no hidden local state.
4. Final acceptance-matrix review, [report evidence register](../report/evidence-register.md),
   known limitations, architecture snapshot, and status update.
5. If a VPS/domain is supplied, add TLS/WSS, firewall, named-environment smoke,
   backup, and rollback evidence before claiming `Deployed`.

Exit gate: M8 final decision in the completion definition is satisfied.

## Change control

New feature ideas are recorded as post-MVP proposals. They do not interrupt
these workstreams unless they fix correctness, security, reproducibility, or a
mandatory acceptance failure.
