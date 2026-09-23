# Project Charter

Status: Accepted
Last updated: 2026-09-24

## Purpose

Build a working, explainable, testable, and reproducibly deployable ride-hailing platform, then extend it to logistics without weakening the ride domain. The project must demonstrate real-time communication, geospatial search, transactional concurrency control, idempotent settlement, observability, and measured performance.

## Primary audience

- Customers requesting transportation.
- Drivers providing transportation.
- Operators diagnosing trips and system health.
- Engineers and academic reviewers evaluating design and evidence.

## Success conditions

1. A complete ride vertical slice runs locally and in a demo/staging environment.
2. Exactly one Driver can reserve or accept a competing Trip under concurrency.
3. Live Trip and Latest Location updates recover predictably from reconnects.
4. Payment simulation is idempotent and reconciliable.
5. Build, tests, migrations, deployment, rollback, and benchmark steps are reproducible.
6. Claims in documentation match observed implementation and test evidence.

## Constraints

- Prefer the smallest architecture that proves the requirements.
- No paid infrastructure or external provider is required for the MVP.
- PostgreSQL is the durable source of truth; caches and brokers are replaceable projections or delivery mechanisms.
- Demo data must be synthetic.
- The VPS is a demo/staging environment, not production.

## Initial non-goals

- Native iOS or Android applications.
- Real money movement, card storage, or payment-provider certification.
- Turn-by-turn navigation or traffic-aware ETA.
- Multi-region availability, Kubernetes, or a service mesh.
- Marketplace incentives, promotions, ratings, and support workflows.
- Full delivery optimization before the ride vertical slice is verified.
