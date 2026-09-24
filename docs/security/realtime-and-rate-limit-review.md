# Realtime and Rate-Limit Security Review

## Scope and method

This is a source-level review of the API, WebSocket gateway, and Nginx
configuration. It does not prove production configuration or resistance to a
live attack. The review covered authentication rate limiting, WebSocket
connection/message handling, Driver GPS ingestion, origin checks, and public
diagnostics.

## Confirmed positives

- Access-token verification pins `HS256`, issuer, and audience.
- Refresh tokens are stored as a digest and rotated; refresh cookies are
  `HttpOnly` and `SameSite=Strict`.
- Trip, Delivery, and realtime subscriptions enforce ownership/assignment in
  repository queries; no direct IDOR was confirmed in this review.
- WebSocket payloads are capped at 64 KiB, unauthenticated sockets expire after
  five seconds, heartbeat handling terminates stale connections, and each
  authenticated connection revalidates its access token and database session
  every 30 seconds. A failed revalidation emits `AUTH_REAUTH_REQUIRED` and
  closes with WebSocket code `1008`.
- Production rejects local development authentication secrets.
- The current production dependency audit reports no high-severity production
  dependency vulnerability.
- Realtime snapshots now expose Driver identity/location only through an
  `ACTIVE` assignment and only while server `received_at` is within the
  15-second freshness window. Terminal Trip/Delivery snapshots retain status
  but do not replay the Driver's last location.
- `SIMULATOR` Driver location writes are rejected when `NODE_ENV=production`;
  local integration fixtures remain able to use the explicit simulator source.
- Incoming WebSocket commands wait for an in-flight authentication revalidation
  before executing, so a revoked session is not allowed to race a command.
- The Driver Console now requires explicit foreground location sharing consent,
  offers a stop control, and stops the watcher when active work ends.

## Findings

### High — WebSocket and GPS quotas are process-local

**Evidence.** `RealtimeGateway` applies a per-connection message quota and a
per-Driver location quota. `LocationService` applies the same process-local
Driver admission interval to REST and WebSocket writes. The controls are not
shared across API instances or restarts, and there is no per-IP upgrade quota.

**Impact.** An abusive or compromised Driver account can consume socket, CPU,
and database capacity through message or GPS-update floods; unauthenticated
connection floods can still consume connection capacity across instances.

**Remediation status: Partial.** Message/GPS quotas, explicit rejection codes,
and focused tests are implemented locally. Add reverse-proxy connection
limits, a shared TTL-backed quota store, and a deployment-level policy before
claiming multi-instance protection.

### Closed locally — stale Driver location and simulator trust boundary

The realtime repository no longer joins completed assignments into the live
Driver projection and filters location rows by server receipt freshness. The
location service rejects `SIMULATOR` input in production. The terminal Trip
snapshot and production simulator rejection are covered by focused tests.
This prevents replay of stale location through this boundary; it does not make
GPS provenance cryptographically trustworthy.

### Closed locally — authentication revalidation command race

When a heartbeat revalidation is in flight, subsequent commands wait for its
result and are discarded if the socket is no longer authenticated. A failed
revalidation clears the actor/token state before closing the socket with code
`1008`.

### Closed locally — foreground location consent

The Driver Console presents the purpose and foreground-only scope before
starting `watchPosition()`, provides a stop action, and clears the watcher
when there is no active assignment. Browser permission and approved Driver
acceptance evidence remain open.

### Medium — Authentication rate limiting is not proxy-aware

**Evidence.** The Fastify adapter is created without `trustProxy`; the
authentication limiter keys on `request.ip`; Nginx forwards
`X-Forwarded-For`. When deployed behind that proxy, the API can treat proxy
traffic as one client identity.

**Impact.** One client can exhaust a shared authentication bucket and affect
other users; source-IP policy is not reliable behind the configured proxy.

**Remediation status: Planned.** Trust only the known reverse-proxy network,
configure Nginx to pass a sanitized client address, and key login protection on
trusted IP plus normalized account identifier.

### Medium — Authentication limiter is process-local

**Evidence.** `InMemoryRateLimiter` is created during API startup. Its state is
lost on restart and is not shared across API replicas.

**Impact.** Limits can be bypassed by restart or distributed across replicas,
reducing protection against credential stuffing.

**Remediation status: Partial.** The limiter now reclaims expired buckets and
has a bounded process-local capacity. Use a shared, TTL-backed limiter suitable
for the deployment topology, with blocked-request and login-failure metrics,
before horizontal deployment.

### Low — WebSocket upgrade Origin policy

**Evidence.** The `/ws` upgrade now compares a supplied `Origin` header exactly
with configured `WEB_ORIGIN` before handing the request to `ws`. A mismatched
origin receives HTTP 403 and is not upgraded. A missing Origin remains allowed
for explicitly supported native clients; those clients must authenticate with
an access token in the first WebSocket message, not with a browser cookie.

**Impact.** Browser connections from untrusted origins can no longer reach the
authenticated WebSocket handshake. Native clients without a browser Origin
remain supported by an explicit token-based policy.

**Remediation status: Implemented and locally verified.** Focused integration
coverage proves the configured origin is accepted, an untrusted origin is
rejected with 403, and a missing origin is accepted only through the documented
native-client path. This does not provide multi-instance connection protection.

### Low — Refresh and logout accepted an absent Origin header

**Evidence.** The origin guard now requires an exact match with `WEB_ORIGIN` for
both refresh and logout. A missing header and an untrusted supplied origin are
rejected before the refresh cookie is read. The refresh cookie remains
`SameSite=Strict` as a second CSRF control.

**Impact.** Before this fix, a cookie-authenticated request without an Origin
header could bypass the intended browser-origin policy.

**Remediation status: Implemented and locally verified.** The identity
integration test proves the configured origin succeeds while missing and
untrusted origins receive `AUTH_ORIGIN_FORBIDDEN` with HTTP 403. Native clients
are not part of the current PWA scope; a future native flow must use explicit
token authentication rather than weakening this cookie boundary.

### Low — Swagger and readiness diagnostics are publicly proxied

**Evidence.** Swagger is mounted at `/api/docs`; Nginx proxies `/api/`; the
readiness response includes the PostGIS version.

**Impact.** Public deployment can expose API metadata and dependency-version
information beyond what is needed by end users.

**Remediation status: Planned.** Restrict Swagger to development or operator
access, expose only liveness publicly, and reserve readiness for internal
monitoring.

## Validation gates

The planned controls are not complete until all applicable gates pass:

- Unit and integration tests prove WebSocket/actor quotas, GPS throttling,
  expiry behavior, and that rejected traffic does not write location records.
- Reverse-proxy integration tests prove trusted client-IP extraction and reject
  spoofed forwarding headers.
- Multi-instance tests prove authentication limits remain effective after a
  restart and across replicas.
- Browser and WebSocket tests prove allowed origins connect and disallowed
  browser origins are rejected without weakening native-client policy.
- Deployment smoke tests prove Swagger and readiness endpoints have the intended
  exposure policy.
- Metrics and structured logs expose rate-limit decisions without logging access
  tokens, refresh tokens, or precise unnecessary location data.
