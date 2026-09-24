# Gove

Gove is an academic real-time ride-hailing and logistics platform. The project is built as a defensible vertical slice first: a customer requests a ride, one eligible driver is reserved and accepts, both parties receive live state updates, the trip completes, and a payment is simulated idempotently.

## Current status

**M6 hardening and M7 logistics closure / Tested locally.** The complete Ride
flow and most of the first parcel Delivery flow are implemented and tested
locally. Customer Delivery creation UI, Delivery realtime, representative
business-load evidence, browser acceptance, security closure, and rollback
evidence remain. No VPS environment, TLS endpoint, or production-capacity
claim has been verified.

## Architecture baseline

- TypeScript on Node.js 24 LTS.
- NestJS modular monolith for HTTP, WebSocket, domain, and application logic.
- React and Vite responsive PWA for Customer, Driver, and Operator views.
- PostgreSQL with PostGIS as the durable source of truth.
- Redis may be introduced for expiring location indexes and multi-instance WebSocket fan-out; it never owns durable business state.
- REST for commands and queries, WebSocket for live projections, and a transactional outbox for reliable asynchronous work.

The modular monolith is intentional. It keeps domain seams explicit while avoiding the operational cost of premature microservices. A module is extracted only when measured load, team ownership, or deployment isolation justifies it.

## Documentation

- [Documentation register](docs/README.md)
- [MVP requirements](docs/requirements/mvp.md)
- [Domain language](CONTEXT.md)
- [Architecture overview](docs/architecture/overview.md)
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
