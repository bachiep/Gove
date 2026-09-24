# PostgreSQL Backup and Restore

Status: Tested locally; current release-baseline recovery completed; off-host recovery pending
Last updated: 2026-09-25

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
the expected application schemas, and a small sampled set of records. For the
current repository baseline, the migration registry must contain exactly the
fourteen ordered versions `0001` through `0014`; the expected schemas include
`identity`, `driver`, `location`, `pricing`, `trip`, `dispatch`, `payment`,
`notification`, `delivery`, and `audit` (plus `public`). Do not point the API
at the restored database until a named recovery decision exists.

## Local verification evidence

On 2026-09-25, a historical backup was created from the disposable local
Compose database and restored into the new database
`gove_restore_20260925_ops1`. The dump was
`gove-20260924T173003Z.dump` with SHA-256
`bfc8449a3c2770a2cb102d998c60fc775e8f4f680f5a269977423536b2415278`.
Verification confirmed the historical thirteen-migration baseline (`0001`
through `0013`),
ten application schemas, and the `payment.payment_attempts.provider` column.
The drill did not target the development database or an external environment.

The backup script was also verified on an ext4-backed temporary directory; it
created a dump with mode `600`. The earlier backup directory on the project
volume uses a FUSE/NTFS filesystem that did not enforce owner-only mode. The
script now fails closed when `600` cannot be enforced, so that volume must not
be treated as secure backup storage.

The current baseline's empty-database migration replay is verified separately
with [`replay-migrations.sh`](../../tools/operations/replay-migrations.sh).
That procedure creates a new `gove_replay_*` database and verifies all
fourteen migrations plus the ten application schemas.

Application image rollback is verified separately by the [local rollback
rehearsal](rollback-rehearsal.md). It keeps the database on the forward schema
and proves that a previous API image can start without losing a synthetic
record; it does not reverse migrations or claim external recovery.

## Current baseline correction

The historical restore drill above predates migration `0014`. A current
release-baseline backup/restore drill was completed on 2026-09-25 from commit
`70f377f`:

- Backup dump: `/tmp/gove-backup-EijpAa/gove-20260924T204847Z.dump`.
- Backup mode: `600`; dump size: `9060707` bytes.
- Restore target: `gove_restore_20260925_rc1`.
- Restore verification: 14 migration rows and 10 application schemas.

The current empty-database replay is recorded in
[`migration-replay-2026-09-25.md`](../testing/migration-replay-2026-09-25.md)
and verifies `0001` through `0014`. The local recovery gate is therefore
tested for the release baseline; off-host retention, encryption and VPS
recovery remain unverified.

## Current limitation

The local drill is not evidence of an off-host backup policy, encrypted backup
storage, or a VPS recovery objective. Those require a named environment and
operator-approved retention policy.
