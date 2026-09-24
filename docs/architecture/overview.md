# Architecture Overview

Status: Designed
Last updated: 2026-09-24

## Runtime shape

Gove is a modular monolith with one deployable application process and one
responsive PWA. The application exposes versioned REST interfaces and an
authenticated WebSocket interface. PostgreSQL 17 with PostGIS owns durable
state. Redis is not required by the current single-process implementation; if
later introduced, it may store only rebuildable, expiring projections and
pub-sub messages.

```text
Customer / Driver / Operator PWA
          | REST + WebSocket
          v
   NestJS application
  ┌──────────────────────────────┐
  │ Identity   Driver   Location │
  │ Pricing    Trip     Dispatch │
  │ Payment    Delivery          │
  │ Realtime   Health / logging  │
  └──────────────────────────────┘
       | transactions     | derived TTL/pub-sub
       v                  v
 PostgreSQL + PostGIS   Redis (later milestone)
```

## Modules and interfaces

Each module owns a small interface and hides persistence, invariants, retries, and error mapping behind it. Callers test through the same seam they use in production.

| Module   | Interface responsibility                                                    | Hidden implementation                                    |
| -------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| Identity | Authenticate, authorize, resolve actor                                      | Password hashing, token rotation, credential persistence |
| Driver   | Manage profile, Vehicle, and eligibility                                    | Approval rules and ownership constraints                 |
| Location | Accept Latest Location and query fresh nearby Drivers                       | Validation, PostGIS query, optional Redis geo projection |
| Pricing  | Create and validate Fare Quotes; finalize Fare                              | Rule versions, rounding, bounded surge policy            |
| Trip     | Create Trip and execute lifecycle commands                                  | Aggregate versioning, transition log, cancellation rules |
| Dispatch | Own Dispatch Request, Driver Work State, Reservation, Offer, and Assignment | Candidate ranking, TTL, transactional contention         |
| Payment  | Capture through a simulator/provider seam                                   | Idempotency and persisted attempt outcomes               |
| Delivery | Own parcel request, reservation, assignment, custody, proof and history     | Delivery versioning, command receipts and privacy        |
| Realtime | Authenticate subscriptions and deliver rebuildable live projections         | WebSocket protocol, snapshots and process-local metrics  |

Identity and IDs are shared kernel types; business entities are not shared
mutable models. Delivery is a separate context and reuses only stable value
types plus the shared exclusive Driver work-state boundary.

## Communication

- REST `/api/v1` handles commands and authoritative snapshots.
- WebSocket `/ws` carries authenticated projections such as Trip snapshots,
  committed Trip events, and Driver location updates.
- Each event carries an event ID, aggregate ID, aggregate version, occurred-at timestamp, and payload version.
- A reconnect fetches the REST snapshot first, then subscribes from the latest known version when supported.
- Durable asynchronous work is published from a transactional outbox. In-process handlers are the first adapter; a broker is added only when independent deployment exists.

## Consistency model

- Trip, Dispatch Request, Driver Reservation, Trip Offer, Assignment, and Driver Work State updates involved in acceptance share one PostgreSQL transaction.
- Row locking or an atomic compare-and-set plus unique constraints produces one winner; retries return conflict or the persisted idempotent outcome.
- Latest Location is last-accepted-write with monotonic capture-time checks and a freshness threshold. It is operational telemetry, not authorization for a Trip transition.
- Read projections and live messages may be eventually consistent; lifecycle commands and settlement remain strongly consistent.

## Technology baseline

- Node.js 24 LTS and strict TypeScript.
- NestJS with Fastify, Vitest, OpenAPI, and WebSocket support.
- React 19 and Vite for the PWA.
- PostgreSQL 17 and PostGIS for transactions and spatial indexing.
- SQL migrations and a PostgreSQL adapter selected for explicit transaction control and spatial queries.
- Docker Compose for local and demo/staging deployment.

Node.js 24 is an LTS line, NestJS supports the installed runtime, Vite supports Node 20.19+ or 22.12+, PostgreSQL 17 remains supported through 2029, and PostGIS provides spatial types and GiST-backed spatial indexing. Version pins live in manifests and container definitions rather than this narrative document.

## Extraction policy

Do not split a module because its name resembles an industry microservice. Extraction requires measured scaling isolation, independent release ownership, a proven failure boundary, or a distinct security boundary. The extracted module must own its datastore, expose a versioned interface, provide contract tests, and have a rollback plan.

## References

- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [NestJS first steps](https://docs.nestjs.com/first-steps)
- [Vite getting started](https://vite.dev/guide/)
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- [PostGIS getting started](https://postgis.net/documentation/getting_started/)
