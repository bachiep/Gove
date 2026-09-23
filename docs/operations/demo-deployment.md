# Demo/Staging Deployment

Status: Tested locally; not deployed
Last updated: 2026-09-24

`compose.staging.yaml` runs the application as a single API process, a static
PWA Nginx container, a migration job, and PostgreSQL/PostGIS. The API and
database are private to the Compose network. Only the PWA Nginx port is bound
to loopback by default, so a VPS must terminate public TLS at a separately
configured reverse proxy or explicitly change the binding after firewall review.

## Preconditions

- Docker Engine and Docker Compose are installed on the target host.
- The repository is at a known commit and the host has enough disk for a
  PostgreSQL volume and image builds.
- A DNS name and certificate process are available before public exposure.
- Secrets are supplied outside the repository. Do not copy a local `.env` to a
  server without replacing development values.

## Required environment

Create an ignored host-side environment file with unique values for:

```text
POSTGRES_PASSWORD=...
AUTH_JWT_SECRET=at-least-32-characters
AUTH_REFRESH_PEPPER=at-least-32-characters
WEB_ORIGIN=https://demo.example.edu
GOVE_HTTP_PORT=8080
```

`WEB_ORIGIN` must be the browser origin used by the reverse proxy. It is an
authorization control for refresh and logout requests, so changing the public
domain requires updating it and restarting the API.

## Bring up and smoke check

```bash
docker compose --env-file /secure/path/gove.env -f compose.staging.yaml up --build -d
docker compose --env-file /secure/path/gove.env -f compose.staging.yaml ps
curl --fail http://127.0.0.1:8080/api/v1/health/live
curl --fail http://127.0.0.1:8080/api/v1/health/ready
```

The migration job must show a successful one-shot exit before the API starts.
The health checks prove only local process and dependency readiness; run the
customer and Driver browser smoke flow before calling an environment deployed.

## Local verification evidence

On 2026-09-24, a disposable Compose project was built and started with
non-secret verification values on loopback port `18080`. PostgreSQL and API
became healthy, the migration job exited successfully, and the PWA proxy served
the application shell plus both API health endpoints. This proves the local
deployment path, not an external VPS, TLS, DNS, or firewall configuration.

## TLS and network boundary

Keep the Compose PWA port loopback-only and put an administrator-managed TLS
reverse proxy in front of it. The proxy must forward `/api/` and `/ws` without
stripping WebSocket upgrade headers, redirect HTTP to HTTPS, and forward the
public host and protocol headers. Configure the firewall to expose only SSH
under project policy and HTTPS; never publish PostgreSQL or the API port.

This repository does not issue certificates or modify VPS firewalls. Those are
environment-owner operations and must be recorded as deployment evidence when
performed.

## Rollback boundary

Application rollback means redeploying the prior known-good commit/image. Do
not roll back a database by deleting the volume. Migrations are additive in the
current project; an incompatible future migration requires an expand-and-
contract plan before release. Restore is a separate operation into a new
database, documented in [Backup and restore](backup-and-restore.md).
