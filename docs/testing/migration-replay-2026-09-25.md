# Migration Replay Evidence — 2026-09-25

Trạng thái: Tested — local isolated database

## Scope

This record verifies that the current repository migration set can build an
empty PostgreSQL/PostGIS database without using the development database.

## Environment

- Compose service: `gove-postgres-1`
- Database: `gove_replay_20260925_ops2`
- Database contents before replay: empty application database
- Migration source: `infra/postgres/migrations`
- Command:

```bash
GOVE_MIGRATION_REPLAY_CONFIRM=CREATE_NEW_DATABASE \
  tools/operations/replay-migrations.sh gove_replay_20260925_ops2
```

## Result

- Migration runner applied exactly 14 versions: `0001` through `0014`.
- `public.schema_migrations` matched the repository migration file set.
- Ten application schemas were present: `identity`, `driver`, `location`,
  `pricing`, `trip`, `dispatch`, `payment`, `notification`, `delivery`, and
  `audit`.
- `docs/report/sql/verification-queries.sql` executed successfully against the
  replay database.
- No duplicate active Driver work state, Ride assignment, Delivery assignment,
  pending Offer, cross-domain assignment, invalid transition, incomplete
  completed Trip, or incomplete delivered Delivery rows were found.
- Unpublished outbox snapshot: `trip=0`, `payment=0`, `delivery=0`.

## Boundary

This is local reproducibility evidence, not staging deployment or backup/
restore evidence. The replay database is intentionally retained because the
replay script never drops generated databases; later cleanup must target this
explicit database name only.
