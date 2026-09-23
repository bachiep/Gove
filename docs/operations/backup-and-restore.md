# PostgreSQL Backup and Restore

Status: Tested locally; restore drill completed
Last updated: 2026-09-24

The scripts in `tools/operations` operate on the local Compose `postgres`
service. They are intentionally not part of application startup and never
delete an existing database.

## Backup

Choose an absolute directory outside the repository or under the ignored
`artifacts/backups` directory. The script writes a PostgreSQL custom-format
dump with owner-only permissions.

```bash
tools/operations/backup-postgres.sh /absolute/backup-directory
```

Record the dump checksum, source commit, source database, and timestamp with
the operational evidence. Encrypt and retain backups according to the project
environment policy; dumps can contain synthetic user data and session records.

## Restore verification

Restore never targets the running application database. It creates a new,
empty database whose name begins with `gove_restore_`; it refuses any existing
database name and requires an explicit confirmation value.

```bash
GOVE_RESTORE_CONFIRM=RESTORE_TO_NEW_DATABASE \
  tools/operations/restore-postgres.sh \
  /absolute/backup-directory/gove-YYYYMMDDTHHMMSSZ.dump \
  gove_restore_20260924
```

Afterward, connect to the new database and verify `public.schema_migrations`,
the expected application schemas, and a small sampled set of records. Do not
point the API at the restored database until a named recovery decision exists.

## Local verification evidence

On 2026-09-24, a backup was created from the disposable local Compose database
and restored into a new `gove_restore_verify` database. The restored database
contained all six versioned migrations. The test did not target the development
database or an external environment.

## Current limitation

The local drill is not evidence of an off-host backup policy, encrypted backup
storage, or a VPS recovery objective. Those require a named environment and
operator-approved retention policy.
