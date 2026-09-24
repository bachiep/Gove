# Final Security and Operations Hardening Review — 2026-09-24

Status: Review complete; public-release and multi-instance gates remain open.

## Scope and evidence boundary

This is a read-only technical review of the current Gove worktree. It covers:

- API and web deployment configuration;
- authentication, session cookies, authorization, and rate limiting;
- WebSocket admission, realtime authorization, and Driver location ingestion;
- backup, restore, migration, and application rollback paths; and
- the acceptance evidence currently retained in the repository.

The review describes the current working tree, not a clean release commit. At
review time, `HEAD` was `43ee662` (`docs: add academic report evidence pack`),
and `git status --short` showed both modified tracked files and untracked
implementation/evidence files. No production host, public endpoint, cloud
account, or live attack surface was accessed. No production availability,
capacity, TLS, firewall, or vulnerability claim is made here.

Recorded evidence is treated according to its scope. A repository document that
records a previous local run is evidence of that run only; it is not a
substitute for a final-commit, clean-environment, staging, or production
verification.

## Overall assessment

The local academic MVP has several sound foundations: Argon2id password
hashing, opaque refresh-session rotation with database-side digests, pinned JWT
verification parameters, role guards, ownership checks for realtime
subscriptions, bounded WebSocket payloads, required production secrets, and an
isolated local application rollback rehearsal.

It is not ready to be described as a public or horizontally scaled service.
The most important unresolved risks are process-local abuse controls, missing
trusted-proxy and WebSocket admission policy, absent externally verified
TLS/WSS and network controls, incomplete current-baseline recovery evidence,
and open browser/performance/security acceptance gates. These are limitations
and validation gaps, not evidence of a confirmed compromise.

Severity used below:

- **High** — a public or multi-instance deployment could suffer material
  security/availability impact, or the control is a release blocker.
- **Medium** — meaningful hardening or operational risk requiring closure before
  a broader deployment claim.
- **Low** — defense-in-depth, information exposure, or reproducibility gap that
  should be closed before production but does not by itself prove compromise.

## Confirmed controls and favorable evidence

- `apps/api/src/identity/password.service.ts` uses Argon2id rather than storing
  plaintext passwords.
- `apps/api/src/identity/token.service.ts:11-44` restricts access-token
  verification to `HS256` and validates issuer and audience.
- `apps/api/src/identity/auth.service.ts:111-164` and
  `apps/api/src/identity/identity.repository.ts:128-184` implement opaque
  refresh-token rotation, HMAC digests, expiry checks, and token-family
  revocation on reuse.
- `apps/api/src/identity/auth.controller.ts:134-141` sets the refresh cookie as
  `HttpOnly`, `SameSite=Strict`, and `Secure` in production.
- `apps/api/src/config/app-config.ts:45-50` rejects the documented development
  JWT and refresh-pepper values when `NODE_ENV=production`.
- Operator, Driver, and realtime routes use authentication and role guards;
  realtime subscriptions are checked against authorized snapshots in
  `apps/api/src/realtime/realtime.gateway.ts:274-323`.
- `apps/api/src/realtime/realtime.gateway.ts:112-115,161-194` limits payload
  size, requires authentication within five seconds, and has heartbeat cleanup.
- `compose.staging.yaml:37-79` does not publish the API or PostgreSQL ports to
  the host; the default PWA binding is loopback-only.
- `.gitignore:1-3` and `.dockerignore:4-8` exclude local environment files,
  `.git`, and build/dependency directories. The review environment had no
  `.env`, `.env.local`, or `.env.production` file. A limited tracked-file scan
  found no common private-key or token literal patterns; this is not a complete
  history-aware secret scan.
- The recorded rollback rehearsal states that the candidate and previous API
  images reached health `200`, twelve migration versions were preserved, and a
  synthetic sentinel survived. The scope is explicitly local and application
  image rollback only.

## Findings

### F-01 — High — WebSocket and GPS abuse controls are process-local

**Affected component:** `RealtimeGateway`, `LocationService`, Driver location
REST/WebSocket commands, and any deployment with more than one API process.

**Evidence:**

- `apps/api/src/realtime/realtime.gateway.ts:62-67` stores clients and actor
  location quota state in process memory.
- `apps/api/src/realtime/realtime.gateway.ts:50-57,197-205,325-345`
  applies per-connection message and per-Driver location windows, but neither
  state is shared across processes or survives a restart.
- `apps/api/src/location/driver-location-rate-limiter.ts:7-31` and
  `apps/api/src/location/location.service.ts:16-25` use another process-local
  map for REST location admission.
- `docs/security/realtime-and-rate-limit-review.md:26-40` records the same
  boundary and marks the remediation partial. `docs/project/known-limitations.md:40`
  records that realtime routing and authentication limits are process-local.

**Impact:** A compromised Driver credential or unauthenticated connection flood
can consume connection, CPU, and database capacity. A restart or a second API
replica creates a fresh quota state, so local limits cannot be presented as a
distributed abuse-control boundary.

**Remediation:** Add a deployment-level connection and request policy at the
trusted ingress; use a shared TTL-backed quota mechanism for authentication,
GPS, and realtime message admission; define per-IP, per-account, and total
connection limits; and add metrics for rejected upgrades, messages, and GPS
writes. Keep database validation authoritative even when the edge rejects
traffic.

**Validation status:** Partial. Local quota behavior and focused integration
coverage are recorded. No restart, multi-instance, or public-edge validation is
recorded.

### F-02 — Medium — Authentication rate limiting is not trusted-proxy aware

**Affected component:** Authentication endpoints behind Nginx or another
reverse proxy.

**Evidence:**

- `apps/api/src/main.ts:21-24` creates `FastifyAdapter` without a
  `trustProxy` policy.
- `apps/api/src/main.ts:32-65` keys the limiter on `request.ip`.
- `infra/nginx/pwa.conf:11-16,18-26` forwards `X-Forwarded-For` for HTTP and
  WebSocket traffic.
- `docs/security/realtime-and-rate-limit-review.md:42-54` identifies the
  resulting proxy boundary as planned work.

**Impact:** With the configured proxy topology, the application-level IP key
may represent the proxy rather than the originating client. One client can
therefore share or exhaust a bucket with other clients, while an untrusted
forwarded address must not be accepted as an identity signal.

**Remediation:** Define the exact trusted proxy network in the Fastify
configuration, sanitize forwarding headers at the edge, reject spoofed chains,
and key credential-abuse protection on a combination of trusted source identity
and normalized account identifier. Verify behavior through a proxy integration
test rather than trusting a header in direct API traffic.

**Validation status:** Not validated. Source review confirms the gap; no
trusted-proxy or spoofed-header test is recorded.

### F-03 — Medium — Authentication limits are not distributed

**Affected component:** Login, registration, and refresh rate limiting.

**Evidence:** `apps/api/src/main.ts:32-35` constructs one
`InMemoryRateLimiter` at startup, and `apps/api/src/common/http/rate-limiter.ts`
stores buckets in a bounded in-memory `Map`. The existing review records that
the state is lost on restart and is not shared across replicas
(`docs/security/realtime-and-rate-limit-review.md:56-67`).

**Impact:** Credential-stuffing protection can be bypassed by restarting the
process or distributing attempts across API replicas. The bounded map prevents
unbounded memory growth in one process but does not solve the deployment-level
policy problem.

**Remediation:** Use a shared, TTL-backed limiter or a trusted ingress policy;
retain bounded local protection as a secondary safeguard; emit counters for
login failures and limit decisions; and test behavior across restart and
replica boundaries.

**Validation status:** Partial. Unit coverage and local fixed-window behavior
exist; distributed and restart behavior are not verified.

### F-04 — Medium — WebSocket upgrade admission has no explicit connection cap

**Affected component:** `/ws` upgrade path and Nginx WebSocket proxy.

**Evidence:** `apps/api/src/realtime/realtime.gateway.ts:109-118` creates a
`WebSocketServer` with `maxPayload` but no maximum connection count or per-IP
upgrade admission policy. The five-second authentication timer at lines
161-174 limits how long an unauthenticated socket remains open, but the socket
still consumes resources during that interval. `infra/nginx/pwa.conf:18-26`
contains upgrade forwarding but no connection, request-rate, or timeout limit.

**Impact:** An unauthenticated handshake flood can consume file descriptors,
memory, event-loop work, and proxy connections even when every socket is later
closed. This is an availability risk distinct from message payload validation.

**Remediation:** Enforce edge connection limits and per-source upgrade quotas,
set explicit idle/read/write timeouts, monitor active and rejected connections,
and define a process-level maximum as a last-resort circuit breaker. Validate
the policy through a bounded local saturation test and proxy configuration
review before claiming public resilience.

**Validation status:** Not validated. Payload-size, authentication-timeout,
heartbeat, and message-limit behavior are covered locally; connection-flood
behavior is not.

### F-05 — Low — Cookie-origin checks accept a missing Origin header

**Affected component:** `POST /api/v1/auth/refresh` and
`POST /api/v1/auth/logout`.

**Evidence:** `apps/api/src/identity/auth.controller.ts:144-151` rejects an
Origin only when it is present and different from `WEB_ORIGIN`. A missing
Origin is accepted. The refresh cookie is nevertheless `SameSite=Strict` and
`HttpOnly` at lines 134-141. The same policy is documented as a hardening gap in
`docs/security/realtime-and-rate-limit-review.md:86-96`.

**Impact:** This weakens the exact-origin defense-in-depth boundary for
cookie-authenticated commands. The code and cookie attributes do not establish
that a browser request without an Origin is trusted. No exploit was attempted
or demonstrated in this review.

**Remediation:** Require an exact Origin for browser cookie flows, or split a
documented native-client flow from the browser flow with an explicit
authentication mechanism and threat model. Preserve SameSite and CSRF testing
as independent controls.

**Validation status:** Partial. Cookie attributes and mismatched-origin
rejection are visible in source and existing local review evidence; absent-
Origin behavior is intentionally permissive and remains planned hardening.

### F-06 — Low — Swagger and readiness information are publicly routable

**Affected component:** API documentation and readiness endpoint exposed through
the PWA proxy.

**Evidence:** `apps/api/src/main.ts:81-90` mounts Swagger unconditionally at
`/api/docs`. `infra/nginx/pwa.conf:11-16` proxies `/api/` without an access
policy. `apps/api/src/health/health.controller.ts:37-62` exposes a public
readiness response containing the PostGIS version. The previous review records
this as planned hardening at `docs/security/realtime-and-rate-limit-review.md:98-108`.

**Impact:** A public deployment can disclose API surface and dependency
metadata that end users do not need. This is information exposure, not proof of
an authorization bypass; the Operator diagnostic routes themselves are guarded
by `OPERATOR` in `apps/api/src/operator/operator.controller.ts:32-36`.

**Remediation:** Disable or protect Swagger in production, restrict readiness to
an internal monitoring path or network, and expose only the minimum liveness
signal publicly. Confirm the intended policy through a staging proxy smoke
test.

**Validation status:** Not validated. The current source exposes both routes;
no staging exposure test is recorded.

### F-07 — Medium — Public deployment TLS/WSS and network posture are unverified

**Affected component:** Staging Compose, Nginx, and any future VPS ingress.

**Evidence:** `compose.staging.yaml:70-79` binds the PWA HTTP port to loopback;
`infra/nginx/pwa.conf:1-3` listens on plain HTTP port 80 and contains no TLS
configuration. `docs/operations/demo-deployment.md` explicitly says the local
deployment is not deployed externally and requires a separately managed TLS
reverse proxy, DNS, certificate process, and firewall review. The acceptance
matrix marks the VPS deployment gate conditional (`docs/project/acceptance-matrix.md:72`).

**Impact:** The local topology is appropriately private by default, but changing
the binding or placing it on a public host without an external TLS/WSS and
firewall boundary would expose credentials, cookies, and realtime traffic or
unintentionally publish services.

**Remediation:** Name the staging host and public origin, terminate HTTPS/WSS
at an administrator-controlled ingress, redirect HTTP, set the required
security headers, expose only the intended ports, and record certificate,
firewall, proxy, and WebSocket upgrade checks. Keep PostgreSQL and the API
private to the Compose network.

**Validation status:** Local loopback Compose smoke is recorded. No public DNS,
TLS/WSS endpoint, firewall, or external host was reviewed.

### F-08 — Low — Container base images and runtime dependencies are not immutable

**Affected component:** API and web Docker images and reproducible deployment.

**Evidence:** `infra/docker/api.Dockerfile:1,14` uses
`node:24-bookworm-slim`; `infra/docker/web.Dockerfile:1,14` uses
`node:24-bookworm-slim` and `nginx:1.27-alpine`; `compose.staging.yaml:5` uses
`postgis/postgis:17-3.5-alpine`. These are version tags rather than immutable
image digests. Both Dockerfiles run `npm ci` in the build stage and copy the
whole build-stage `node_modules` into the API runtime at
`infra/docker/api.Dockerfile:19`, so development dependencies are not
explicitly pruned from the runtime image.

**Impact:** Rebuilds can resolve different base-image bytes, weakening
reproducibility and rollback confidence. Carrying development dependencies
increases image size and attack surface; no vulnerable package is asserted by
this review.

**Remediation:** Pin base images by reviewed digest, record the image digest and
SBOM for a release, and install/prune production dependencies in the runtime
stage. Rebuild from a clean checkout and compare the resulting deployment
manifest before relying on image identity for rollback.

**Validation status:** Lockfile and syntax checks pass; immutable-image and
runtime-dependency validation are not recorded.

### F-09 — Medium — Current-baseline backup and external recovery evidence is incomplete

**Affected component:** PostgreSQL backup/restore, retention, and disaster
recovery procedure.

**Evidence:** `tools/operations/restore-postgres.sh:7-17` requires an absolute
backup file, a new `gove_restore_*` database, and explicit confirmation; this is
a useful destructive-action safeguard. However,
`docs/operations/backup-and-restore.md` states that the recorded restore drill
predated the Delivery and Operator migrations and verified only six versions,
not the current twelve-version baseline. It also states that off-host
encryption, retention, and recovery objectives are not verified. The rollback
document explicitly limits its result to local application image replacement
and does not prove database rollback, registry availability, web-image rollback,
or production recovery (`docs/operations/rollback-rehearsal.md:64-70`).

**Impact:** A local rehearsal can show that the scripts work without proving
that the current schema and representative records can be recovered in the
intended environment, within an agreed RPO/RTO, after host or storage loss.

**Remediation:** Repeat backup and restore from a database migrated through
`0012`, record checksum, migration registry, schema checks, and representative
Delivery/Operator records, then define encrypted off-host retention and RPO/RTO.
Rehearse recovery on the named staging host and document web/API image rollback
and registry failure behavior.

**Validation status:** Local application rollback and an earlier local restore
drill are documented; current-baseline restore and external recovery are open.

### F-10 — Medium — Secret-handling validation is narrower than the acceptance gate

**Affected component:** Repository history, final build context, deployment
secrets, and release process.

**Evidence:** The source has useful safeguards: `.gitignore:1-3`,
`.dockerignore:1-8`, production secret rejection in
`apps/api/src/config/app-config.ts:45-50`, and required staging secret
variables in `compose.staging.yaml:29-55`. This review also checked for a small
set of common private-key/token literal patterns in tracked files and found no
matches, and confirmed that local `.env` variants were absent. Those checks do
not inspect all Git history, every secret format, dependency metadata, Docker
cache, or external CI artifacts. `docs/project/acceptance-matrix.md:27` keeps
NFR-02 Partial and explicitly requires a final scan/history review.

**Impact:** A clean current tree and placeholder configuration do not prove that
credentials have never entered history or build artifacts. A leaked JWT secret,
refresh pepper, database password, or CI credential would require rotation and
incident handling.

**Remediation:** Run an approved history-aware secret scanner on the final
commit range and CI artifacts, review Docker build context/cache policy, verify
secret rotation, and retain only sanitized evidence. Do not place scanner raw
output or credentials in the repository.

**Validation status:** Limited pattern scan and ignored-file checks passed;
full history-aware secret review is not completed by this audit.

### F-11 — Medium — Identity hardening features remain outside the implemented boundary

**Affected component:** Account lifecycle and operational identity management.

**Evidence:** `docs/security/authentication-and-authorization.md:18-23`
records that there is no email verification, password reset, MFA, or operator
provisioning workflow. The implementation supports password login, sessions,
and role checks, but does not provide those additional lifecycle controls.

**Impact:** An account compromise or lost credential has fewer recovery and
step-up-authentication controls. Operator access must be provisioned through a
controlled environment/database process rather than a complete application
workflow.

**Remediation:** Before treating the system as an operational public identity
service, add verified account recovery, MFA or an equivalent step-up policy for
operators, and auditable operator provisioning. Document the threat model if
these remain explicitly excluded from the academic MVP.

**Validation status:** Accepted MVP limitation; no implementation or validation
claim is made.

### F-12 — High release blocker — Acceptance evidence is not yet complete

**Affected component:** Final release claim across API, PWA, realtime,
performance, security, and deployment.

**Evidence:** The current acceptance matrix records the following gates as
partial or open (`docs/project/acceptance-matrix.md:26-34,59-72`):

- final static/automated check at the final commit, with prior development-DB
  isolation failures still documented;
- complete Customer/Driver Ride browser flow with reconnect;
- complete Customer/Driver Delivery custody lifecycle in the browser;
- repeated concurrency races with invariant queries;
- accepted-Driver workload and resource profile rather than only the bounded
  no-Driver smoke;
- proxy-aware and multi-instance security validation;
- clean-environment/staging smoke; and
- current recovery and VPS/TLS evidence.

`docs/testing/browser-acceptance-2026-09-24.md` explicitly says its browser run
covered Customer Delivery creation, no-Driver matching, history/detail, and
375px layout, but not Driver custody completion. The benchmark report records
16 attempts and 48 requests with zero matched/accepted/completed trips and
explicitly disclaims capacity, WebSocket, resource, contention, and
multi-instance conclusions. These are recorded evidence values, not new
measurements from this audit.

**Impact:** The repository can support a truthful local academic MVP claim, but
the available evidence does not support `Production-ready`, `Deployed`,
multi-instance protection, representative capacity, or complete end-to-end
acceptance claims.

**Remediation:** Close each matrix gate in its matching environment: run the
final checks on an isolated clean database/checkout, perform the browser Ride
and Delivery Driver paths including reconnect, retain accessibility evidence,
repeat the required race scenarios with invariant queries, run an
accepted-Driver workload with resource measurements, validate the security
controls through the intended proxy topology, and complete current-baseline
recovery and named staging evidence.

**Validation status:** Open. This review did not rerun database-mutating
integration, load, browser, or deployment tests; the repository's retained
matrix remains the authoritative status record for those gates.

## Safe checks run during this review

The following checks were read-only or validation-only and were run against the
current worktree. They did not alter source code, database state, Docker
resources, or other documentation:

| Command/check                                                                                                                                                   | Result                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status --short && git branch --show-current && git log -1 --oneline`                                                                                       | `main`; `43ee662`; worktree contains pre-existing modified and untracked files                                                              |
| `git diff --check`                                                                                                                                              | Pass; no whitespace errors                                                                                                                  |
| `docker compose -f compose.yaml config --quiet`                                                                                                                 | Pass                                                                                                                                        |
| `docker compose -f compose.staging.yaml config --quiet` with non-secret placeholder environment values                                                          | Pass                                                                                                                                        |
| `bash -n tools/operations/backup-postgres.sh tools/operations/restore-postgres.sh tools/operations/replay-migrations.sh tools/operations/rollback-rehearsal.sh` | Pass                                                                                                                                        |
| `node --check tools/load/api-load.mjs`                                                                                                                          | Pass                                                                                                                                        |
| `npm run format:check`                                                                                                                                          | Pass; all files matched Prettier style                                                                                                      |
| `npm run lint`                                                                                                                                                  | Pass; `oxlint .` completed successfully                                                                                                     |
| Limited tracked-file secret-pattern scan and local `.env*` presence check                                                                                       | No matched common key/token literals; `.env`, `.env.local`, and `.env.production` absent in the review environment. Not a full secret scan. |

The audit intentionally did not run the database-mutating integration suite,
load workload, browser workflow, Docker deployment, backup/restore, or rollback
rehearsal. Existing reports for those activities are cited with their stated
scope and limitations rather than being presented as fresh validation.

## Priority closure order

1. Before any public or multi-instance exposure: implement trusted-proxy and
   shared abuse controls, edge WebSocket admission limits, exact diagnostics
   exposure policy, and a named TLS/WSS/firewall boundary.
2. Before a stronger release claim: complete current-baseline backup/restore,
   clean-checkout/staging evidence, and the browser/concurrency/accepted-Driver
   acceptance gates.
3. Before production identity use: complete history-aware secret review, pin
   image digests/prune runtime dependencies, and decide the account recovery,
   MFA, and operator-provisioning policy.

Until these items are closed with matching evidence, the strongest supported
statement is: **verified local academic MVP with documented hardening gaps;
not production-ready and not externally deployed**.
