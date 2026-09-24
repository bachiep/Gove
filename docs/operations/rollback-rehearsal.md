# Local Application Rollback Rehearsal

Status: Tested locally; no external deployment claim
Last updated: 2026-09-25

`tools/operations/rollback-rehearsal.sh` verifies the application rollback
boundary without modifying the development database or an external host. It
builds two API images, starts a uniquely named local Compose project, applies
the current migration set to a new database volume, and then replaces the API
with an image built from an explicitly supplied previous Git ref.

This is an application rollback rehearsal, not an in-place database rollback.
The project has no down-migration path. The database remains on the forward
schema, and the previous application must start against that schema. Database
recovery is a separate backup/restore procedure.

## Safety contract

- The command requires `GOVE_ROLLBACK_CONFIRM=LOCAL_ROLLBACK_REHEARSAL`.
- The previous application ref is mandatory; there is no implicit fallback.
- The rehearsal creates only a generated Compose project and volume whose names
  begin with `gove_rollback_`.
- No host port is published and no development database is used.
- A synthetic `example.invalid` sentinel verifies that data survives the image
  replacement and migration check.
- Successful runs remove only the generated project, volume, and images. A
  failed run keeps its exact named project for inspection rather than deleting
  resources blindly.

## Run locally

Use a known local commit or tag as the previous application version:

```bash
GOVE_ROLLBACK_CONFIRM=LOCAL_ROLLBACK_REHEARSAL \
  tools/operations/rollback-rehearsal.sh 43ee662
```

The current working tree is the candidate. The previous ref is archived into a
temporary build context, so uncommitted files are not included in the rollback
image. Set `GOVE_ROLLBACK_KEEP_RESOURCES=1` or
`GOVE_ROLLBACK_KEEP_IMAGES=1` only when inspection is required.

If a run fails, inspect the exact project printed by the script. Do not use a
wildcard cleanup command. After inspection, the named project can be stopped
with the same generated Compose file and `down --volumes`; the script never
removes an unrelated Docker resource.

## Local evidence

On 2026-09-24, the final verification run used the candidate working tree and
previous ref `43ee6627e1a3a2bbb5642dc53c2094bef699ac86`. The generated project
was `gove_rollback_20260924t074828z_209800_31442`. Results:

- Candidate API health: `200`.
- Candidate database: all twelve migrations in the recorded run were applied;
  that run predates `0013-payment-provider-baseline.sql`.
- Previous-image API health after replacement: `200`.
- Previous-image migration runner: completed against the forward-compatible
  schema without changing the migration registry.
- Migration versions preserved after rollback: `12` in the recorded pre-`0013`
  run.
- Synthetic sentinel preserved: exactly one record.
- Cleanup: generated Compose volume and network were removed by the script.

The final run completed without a migration retry after the explicit SQL
readiness check. An earlier run exposed the PostGIS initialization restart
race; that is why the readiness check and bounded migration retry are part of
the script. The rehearsal proves local image replacement and forward-schema
compatibility for the recorded pre-`0013` run only. Rerun it against the
current fourteen-migration baseline before using it as current release
evidence. It does not prove a VPS rollback, TLS/WSS behavior,
registry availability, web image rollback, backup retention, or a production
recovery objective.
