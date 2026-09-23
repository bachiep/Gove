# Local Development

Status: Tested locally
Last updated: 2026-09-24

This page defines the M0 developer interface. The install, infrastructure, migration, development, check, and build paths have been exercised in the current workspace. A clean-checkout run and GitHub CI result remain outstanding.

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

## Data safety

- Use synthetic fixtures only.
- Migrations run against the project database, never an unrelated local container.
- Reset scripts require an explicit development database name and refuse production-like environments.
- PostgreSQL volumes survive application and Redis restarts.
