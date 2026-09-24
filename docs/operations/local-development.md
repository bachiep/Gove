# Local Development

Status: Tested locally
Last updated: 2026-09-25

This page defines the M0 developer interface. The install, infrastructure,
migration, development, check, build, and empty-database migration replay paths
are defined for the current workspace. The current-baseline replay is recorded
below; a clean-checkout run from the final release commit remains outstanding.

## Prerequisites

- Node.js 24 LTS and npm 11.
- Docker Engine with Docker Compose.
- Git.

No host PostgreSQL, PostGIS, Redis, or reverse proxy installation is required.

## Commands

| Command                                | Intent                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| `npm ci`                               | Install exactly the locked workspace dependencies               |
| `docker compose up -d --wait postgres` | Start the durable local dependency                              |
| `npm run db:migrate`                   | Apply versioned schema migrations                               |
| `npm run dev`                          | Run API and PWA in watch mode                                   |
| `npm run check`                        | Run formatting check, lint, typecheck, unit, and contract tests |
| `npm run build`                        | Produce deployable application artifacts                        |
| `npm run load:api`                     | Run the bounded local API load baseline                         |

## Empty-database migration replay

To verify the complete migration set without touching the development
database, create a new Compose PostgreSQL database and replay every migration:

```bash
GOVE_MIGRATION_REPLAY_CONFIRM=CREATE_NEW_DATABASE \
  tools/operations/replay-migrations.sh gove_replay_<unique-name>
```

The script accepts only `gove_replay_*` names, refuses an existing target, and
does not drop the database after the run. It verifies that
`public.schema_migrations` exactly matches the SQL files in
`infra/postgres/migrations` and that the ten application schemas are present.
Use a new target name for each run; remove replay databases only through a
separately reviewed operator procedure.

### Current evidence

On 2026-09-25, `gove_replay_20260925_ops2` was created from the local Compose
PostgreSQL service. The runner applied all fourteen migrations (`0001` through
`0014`), verified `Applied versions: 14` and `Application schemas verified: 10`,
and did not reset or modify the development database. The accompanying
invariant queries returned zero rows for the checked violations and unpublished
outbox records. This is current working-tree evidence; repeat it from the
final release commit before marking the release gate Verified.

## Local ports

| Port  | Process                        | Exposure                                 |
| ----- | ------------------------------ | ---------------------------------------- |
| 3000  | API and WebSocket              | Host local only                          |
| 5173  | PWA development server         | Host local only                          |
| 55432 | PostgreSQL/PostGIS             | Host local only; development credentials |
| 6379  | Redis profile, when introduced | Host local only                          |

## Configuration

`.env.example` contains names and safe placeholders. `.env` is ignored. Startup validates every required variable and exits with a clear error when configuration is missing or malformed.

The PWA proxies `/api` to the API during development. API documentation is available at `http://127.0.0.1:3000/api/docs`; liveness and dependency-aware readiness are exposed under `/api/v1/health`.

Routing uses the coordinate fallback unless `ROUTING_OSRM_BASE_URL` is
explicitly configured. The optional local OSRM profile, external data-volume
contract, and fallback rules are documented in
[Optional OSRM staging seam](osrm-staging.md); it is not part of the default
`docker compose up -d --wait postgres` command.

Authentication endpoints use a process-local rate limiter configured by `AUTH_RATE_LIMIT_WINDOW_SECONDS` and `AUTH_RATE_LIMIT_MAX`. It is suitable for local and single-process demonstrations only; a multi-instance deployment needs enforcement at a trusted shared boundary.

## Data safety

- Use synthetic fixtures only.
- Migrations run against the project database, never an unrelated local container.
- Reset scripts require an explicit development database name and refuse production-like environments.
- PostgreSQL volumes survive application and Redis restarts.
