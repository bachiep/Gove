# ADR 0004: Use rotating opaque refresh sessions

Status: Accepted
Date: 2026-09-24

## Context

The PWA needs a session that survives short-lived access tokens without making browser storage the authority for long-lived credentials. A stolen refresh token must be revocable and its reuse must have defined behavior.

## Decision

Issue short-lived signed access tokens and store opaque refresh tokens only in an HttpOnly, `SameSite=Strict` cookie. Persist only an HMAC digest of each refresh token. On refresh, lock and rotate the session; if a non-active token in a family is presented, revoke active sessions in that family. Each protected request checks both JWT claims and the current session/user authentication epoch.

## Consequences

- Logout and suspected replay can revoke durable server-side session state.
- The browser client never stores a refresh token or access token in local storage.
- The database performs an additional session lookup for protected requests; this is accepted for the M1 scope and must be measured before introducing a cache.
- Cross-origin session requirements would require a new CSRF and cookie-policy decision.

## Alternatives considered

1. **Long-lived JWT only** — rejected because revocation and replay response are weak.
2. **Refresh JWT with no database record** — rejected because rotation and family invalidation are not durable.
3. **Persist raw refresh tokens** — rejected because a database disclosure would expose immediately usable credentials.
