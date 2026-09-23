# Authentication and Authorization Boundary

Status: Implemented and tested locally
Last updated: 2026-09-24

## Implemented controls

- Passwords are hashed with Argon2id. Plaintext passwords are neither logged nor stored.
- Email addresses are normalized to lowercase before uniqueness checks.
- Refresh tokens are random opaque values. PostgreSQL stores an HMAC digest, never the raw token.
- Refresh sessions rotate on use. Reuse of a non-active session revokes its active session family.
- Access JWTs use HS256 with configured issuer and audience. They contain subject, session ID, and authentication epoch; server-side session status is checked before protected access.
- Production configuration rejects the development default JWT and refresh-token secrets.
- Authorization is enforced with a global authentication guard and route-level role guard. Driver routes derive ownership from the authenticated actor.
- The API emits a correlation ID with responses and returns safe structured error bodies.

## Explicit limitations

- Login and registration have no durable distributed rate limiter yet. Deployment hardening must add a trusted reverse-proxy rate policy and test it.
- Accounts have no email verification, password reset, MFA, or operator provisioning workflow yet.
- The current origin check is an additional browser control, not a replacement for CSRF analysis when cross-site requirements change.
- Authorization tests cover the implemented self-service boundary. Customer trip ownership and operator audit permissions belong to later milestones.

## Operational rules

- Supply `AUTH_JWT_SECRET` and `AUTH_REFRESH_PEPPER` through deployment secrets; never commit them.
- Rotate secrets by deploying new configuration and revoking sessions where required by the incident scope.
- Treat a session replay alert as a reason to invalidate the affected session family and investigate the correlation IDs around it.
