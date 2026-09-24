# Gove

Gove is an academic real-time ride-hailing and logistics platform. The project is built as a defensible vertical slice first: a customer requests a ride, one eligible driver is reserved and accepts, both parties receive live state updates, the trip completes, and payment is handled idempotently through the `SIMULATOR` provider. `MOMO` and `SEPAY` currently provide an explicit `PENDING` integration baseline only.

## Current status

**M6 hardening, M7 logistics closure, and M7.1 map/operator foundation / Tested
locally.** The complete Ride flow; Customer Delivery creation, history, detail,
and realtime projection; and Driver Delivery offer, custody, and handoff
commands are implemented. Delivery WebSocket snapshots/events and the initial
Customer map projection are also covered by local automated evidence; the
recorded browser evidence now covers a local synthetic Customer-and-Driver
Delivery custody path through `DELIVERED` and a local MapLibre renderer
preview, but not GPS permission, reconnect, vector basemap, or road routing. Representative
business-load evidence, security closure, current-baseline rollback evidence,
road routing, full live Driver marker flows, and road-based ETA remain. No VPS
environment, TLS endpoint, or production-capacity claim has been verified.

## Architecture baseline

- TypeScript on Node.js 24 LTS.
- NestJS modular monolith for HTTP, WebSocket, domain, and application logic.
- React and Vite responsive PWA for Customer, Driver, and Operator views.
- PostgreSQL with PostGIS as the durable source of truth.
- Redis may be introduced for expiring location indexes and multi-instance WebSocket fan-out; it never owns durable business state.
- REST for commands and queries, WebSocket for live projections, and a transactional outbox for reliable asynchronous work.

The local migration runner applies the ordered PostgreSQL migration set
`0001` through `0014`. It establishes the foundation, identity, Driver,
pricing/Trip, Dispatch, completion/payment, Delivery, Delivery dispatch and
custody proof, Operator diagnostic audit, Ride cancellation, Driver onboarding
review, payment-provider baseline, and Operator onboarding idempotency schemas.

The modular monolith is intentional. It keeps domain seams explicit while avoiding the operational cost of premature microservices. A module is extracted only when measured load, team ownership, or deployment isolation justifies it.

## Documentation

- [Documentation register](docs/README.md)
- [MVP requirements](docs/requirements/mvp.md)
- [Domain language](CONTEXT.md)
- [Architecture overview](docs/architecture/overview.md)
- [Map, live location, and ETA](docs/architecture/map-and-eta.md)
- [Payment provider baseline](docs/payments/provider-integration-baseline.md)
- [Roadmap](docs/project/roadmap.md)
- [Completion definition](docs/project/completion-definition.md)
- [Acceptance matrix](docs/project/acceptance-matrix.md)
- [First vertical slice](docs/implementation/vertical-slice-01.md)
- [Testing strategy](docs/testing/strategy.md)
- [Demo/staging deployment](docs/operations/demo-deployment.md)
- [Backup and restore](docs/operations/backup-and-restore.md)

## Status vocabulary

Project claims use these states: **Planned**, **Designed**, **Implemented**, **Tested**, **Verified**, and **Deployed**. A later state requires evidence for every earlier state. No performance or production-readiness claim is valid without recorded measurements.

## Repository policy

Commit source code, tests, schemas, deployment configuration, and normal technical documentation. Never commit credentials, real personal data, private environment files, prompts, chat transcripts, session reports, or workflow-provenance artifacts.
