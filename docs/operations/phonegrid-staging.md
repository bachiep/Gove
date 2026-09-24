# PhoneGrid staging deployment runbook

Status: Planned — not yet executed or verified on the PhoneGrid node.

Last updated: 2026-09-24

## Purpose and boundary

This runbook defines the intended Gove staging topology for a dedicated LG V50
ThinQ node managed by PhoneGrid. It is a demo/staging environment, not a
production deployment.

The planned node characteristics are:

- LG V50 ThinQ stock Android 12, `arm64-v8a`, rooted with Magisk and running
  Termux.
- PhoneGrid is the sole process supervisor for health checks and restarts.
- The phone runs Gove API, the built web application, PostgreSQL/PostGIS, and
  Cloudflare Tunnel.
- OSRM is an optional external service. If it is unavailable, the API uses its
  configured coordinate-based routing fallback and the UI must describe the
  result as an estimate.
- The initial service area is inner Hanoi. All demo coordinates, fixtures and
  routing data must use the same area before the environment is announced.

PostgreSQL, API and application logs must not be exposed directly to the
Internet. Cloudflare Tunnel is the public ingress for a temporary demo URL;
the URL is expected to change after a Quick Tunnel restart and is not suitable
for a permanent payment-webhook endpoint.

## Planned topology

```text
Browser
  -> HTTPS/WSS
Cloudflare Tunnel on LG V50
  -> local reverse proxy / web server
     -> Gove PWA static files
     -> /api and /ws -> Gove API
                         -> local PostgreSQL/PostGIS
                         -> optional external OSRM

PhoneGrid
  -> health checks and restart of the deployment supervisor only

LAN Linux host
  <- encrypted PostgreSQL backup artifacts
```

## Preconditions

Complete and record each check before installation. Do not mark this runbook
as executed until the checks have evidence from the actual LG V50.

- The target PhoneGrid node is identified as the LG V50 and is reachable
  through the approved PhoneGrid/ADB management path.
- PhoneGrid has a single service definition for Gove and is configured as the
  only restart authority. Termux:Boot, cron, systemd emulation, and ad-hoc
  shell loops must not independently restart the same service.
- A Termux environment is available with current package metadata, network
  access, Git, Node.js/npm, PostgreSQL, a reverse proxy or static web server,
  and `cloudflared` compatible with Android `arm64-v8a`.
- The repository is cloned to a private application directory on the phone at
  a known commit. The Git working tree is clean before deployment.
- Storage, available memory, device temperature, network reachability and
  PhoneGrid telemetry are recorded at idle. The node's battery-protection
  policy is managed by PhoneGrid and must be treated as an operational input,
  not as a failed charging state.
- PostgreSQL data resides in an application-private persistent directory, not
  in the Git checkout or a temporary directory.
- A LAN Linux host is reachable over an approved private-network path and has
  space for encrypted database backups.
- A Cloudflare account/tunnel configuration is available. For a Quick Tunnel,
  record the temporary public URL for the current demo session only.
- No MoMo, SePay, JWT, database, Cloudflare, or encryption secret is present
  in the repository, shell history, screenshots, logs, or chat transcripts.

## Installation prerequisites

The following steps are planned commands and must be adapted to the actual
Termux package names and PhoneGrid service interface at execution time.

1. Update Termux packages and install the required runtime tools: Node.js/npm,
   PostgreSQL, OpenSSL or another reviewed encryption tool, a reverse proxy or
   static-file server, Git, `curl`, and `cloudflared` for `arm64-v8a`.
2. Create application-private directories for the repository checkout,
   PostgreSQL cluster/data, logs, environment files, backups and temporary
   restore validation. Apply owner-only permissions to environment, database
   and backup-key material.
3. Initialize PostgreSQL/PostGIS using a non-default administrator password;
   create the Gove database role and database; enable PostGIS; and restrict the
   listener to loopback or the approved local interface only.
4. Clone the private Gove repository at the selected release commit, install
   locked dependencies, build the API and PWA, and run database migrations.
5. Configure a local reverse proxy/static server that serves the PWA and
   forwards `/api/` and `/ws` to the API without removing WebSocket upgrade
   headers.
6. Configure Cloudflare Tunnel to send only the public HTTPS/WSS origin to the
   local reverse proxy. Do not map PostgreSQL or the API port directly.
7. Create one PhoneGrid-managed deployment unit that starts dependencies in
   order, writes structured output to the chosen log directory, exposes health
   checks, and stops all Gove child processes on restart.

## Environment configuration

Create separate owner-readable environment files outside Git: one on the PC
for local development and one on the LG V50 for staging. Do not copy a local
development environment file to staging without replacing development-only
values.

The staging file must supply values for these names as applicable:

```text
NODE_ENV
API_HOST
API_PORT
WEB_ORIGIN
POSTGRES_PORT
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
DATABASE_URL
AUTH_ACCESS_TTL_SECONDS
AUTH_ISSUER
AUTH_AUDIENCE
AUTH_JWT_SECRET
AUTH_REFRESH_PEPPER
AUTH_REFRESH_TTL_DAYS
AUTH_RATE_LIMIT_WINDOW_SECONDS
AUTH_RATE_LIMIT_MAX
GOVE_HTTP_PORT
```

Routing and payment integration configuration must use their documented
provider-specific environment-variable names when those adapters are enabled.
Credentials are inserted only by the environment owner. The application must
start with payment UI in its truthful test/development state unless verified
MoMo or SePay credentials and callback handling have been configured.

`WEB_ORIGIN` must exactly match the current public HTTPS origin. Changing a
Quick Tunnel URL requires updating `WEB_ORIGIN`, restarting the API through
PhoneGrid, and rerunning the browser verification section below.

## Planned launch procedure

1. Select a tested commit and record its commit ID, deployment time, node ID,
   environment-file version identifier (not secret content), and expected
   public origin.
2. Verify the Git worktree is clean, review the environment file permissions,
   and check that PostgreSQL data and backup directories are outside the
   checkout.
3. Start PostgreSQL, confirm local connectivity and PostGIS availability, then
   run migrations exactly once. A migration failure stops the deployment.
4. Build or install the selected API and PWA artifacts, then start the local
   web/reverse-proxy service and API under the PhoneGrid deployment unit.
5. Verify local liveness and readiness endpoints before starting Cloudflare
   Tunnel. Do not publish a failed local deployment.
6. Start the tunnel via the same PhoneGrid-managed unit, record the public
   origin, set `WEB_ORIGIN` to that origin, and restart the API once if it
   changed.
7. Run the verification checklist. Only after it passes may the public URL be
   shared for the current demo session.

## Health checks and operational checks

The exact local port is deployment configuration. From the LG V50, verify:

```bash
curl --fail http://127.0.0.1:<GOVE_HTTP_PORT>/api/v1/health/live
curl --fail http://127.0.0.1:<GOVE_HTTP_PORT>/api/v1/health/ready
```

Then verify from an external browser at the Cloudflare public origin:

- The PWA loads over HTTPS and has no mixed-content errors.
- `/api/v1/health/live` and `/api/v1/health/ready` are reachable only through
  the intended public proxy path.
- A WebSocket client connects over WSS and reconnect behavior is observed after
  one controlled API restart.
- Customer registration/login, quote, ride creation and status updates work
  with Hanoi demo locations.
- Driver login and approved-driver flow are checked with an authorized test
  account; location and trip events are visible only to the authorized trip
  participants.
- The Delivery flow, if enabled for the release, is checked separately.
- Payment UI accurately identifies test/development state until provider
  sandbox end-to-end evidence exists.
- When OSRM is unavailable, the route/ETA presentation uses the documented
  fallback and does not claim road-network accuracy.
- PhoneGrid reports the expected service state, process count, memory,
  temperature and restart count. A single controlled restart returns the
  environment to readiness without data loss.

Record command output, release commit, public origin, test accounts without
their credentials, browser evidence, and known limitations in the deployment
evidence location. Do not record secrets or raw sensitive payment payloads.

## Rollback

Application rollback is a release rollback, not a deletion of database data.

1. Stop public sharing and record the incident time, current commit, error and
   PhoneGrid health state.
2. In PhoneGrid, stop the single Gove deployment unit and confirm its child
   processes have exited.
3. Revert the application checkout/artifacts to the previous known-good commit
   that is compatible with the current database schema.
4. Reinstall/build only the selected release, retain the current PostgreSQL
   data directory, and restart via PhoneGrid.
5. Run local health checks and the external browser smoke flow before
   republishing the URL.

Do not downgrade migrations by deleting tables, volumes, or the PostgreSQL
cluster. If a migration is not backward compatible, stop and use a tested
restore/recovery procedure instead of attempting an ad-hoc schema rollback.

## Encrypted backup

The planned backup destination is a Linux host on the private LAN. GitHub,
Cloudflare Tunnel and public object storage are not backup destinations.

1. Use `pg_dump` against the local Gove database with a consistent, restorable
   format.
2. Encrypt the dump before it leaves the LG V50 using an encryption key stored
   outside the repository and separate from the dump.
3. Transfer the encrypted artifact and a checksum to the approved LAN Linux
   destination using an authenticated private-network mechanism.
4. Retain only the number of backups defined by the environment owner; verify
   available storage before creating a new backup.
5. Log timestamp, database release/schema version, encrypted artifact name,
   checksum, transfer result and retention outcome. Never log keys or database
   passwords.
6. Perform restore validation on a separate temporary PostgreSQL database or
   isolated host; never test a restore by overwriting the active staging
   database.

## Restore procedure

Use this only after confirming the target, selected backup timestamp and
impact. Restore is a state-changing operation.

1. Put the public demo offline and stop the PhoneGrid-managed Gove deployment
   unit.
2. Preserve the affected PostgreSQL data directory or take a new encrypted
   forensic backup before changing it.
3. Copy the selected encrypted backup from the LAN Linux host, verify its
   checksum, and decrypt it only in a private temporary directory.
4. Restore into an isolated validation database first. Run schema checks,
   liveness/readiness, and a non-destructive application smoke test.
5. After validation and explicit operator approval, restore the selected data
   to the staging target using the reviewed PostgreSQL restore command for the
   dump format.
6. Restart Gove through PhoneGrid, run migrations only if the selected backup
   requires the release's compatible schema path, then run the complete health
   and browser verification checklist.
7. Record the restore source, checksum, approver, outcome and any data-loss
   window without recording secret material.

## Completion criteria for this runbook

This runbook remains **Planned** until all of the following have been captured
from the LG V50 deployment:

- PhoneGrid-supervised launch and controlled restart evidence.
- Local and Cloudflare public HTTPS/WSS health evidence.
- Browser evidence for the core customer and Driver flow using Hanoi data.
- Verified PostgreSQL encrypted backup transfer to the LAN Linux host.
- Verified restore into an isolated database.
- Documented OSRM availability or fallback behavior.
- Documented payment-provider state; sandbox or live payment claims require
  their own provider webhook and reconciliation evidence.
