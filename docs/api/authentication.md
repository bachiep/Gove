# Authentication API

Status: Implemented and tested locally
Last updated: 2026-09-24

The public API is prefixed with `/api/v1`. All error responses use the stable shape `{ code, message, correlationId, details? }`; clients must branch on `code`, not English message text.

## Session model

- A successful login or refresh returns a short-lived bearer access token in the response body.
- The refresh token is an opaque value held only in the `gove_refresh` HttpOnly, `SameSite=Strict` cookie scoped to `/api/v1/auth`.
- The web client holds the access token in memory. It does not persist either token in web storage.
- Refresh and logout reject a supplied `Origin` other than configured `WEB_ORIGIN`. An absent Origin is allowed for non-browser clients and is documented as a hardening follow-up.

## Public endpoints

| Endpoint              | Request                                                                                                        | Success                                           | Failure behavior                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register` | `displayName`, `email`, `password` (12–128 chars), `role` (`CUSTOMER` or `DRIVER`); required `Idempotency-Key` | `201` and safe actor representation               | Same key and same request replays the prior `201`; a changed request for that key is rejected; duplicate email is `409` |
| `POST /auth/login`    | `email`, `password`                                                                                            | `200`, access token and actor; refresh cookie set | Invalid credentials return `401` without revealing whether the email exists                                             |
| `POST /auth/refresh`  | Refresh cookie                                                                                                 | `200`, rotated access token and refresh cookie    | Invalid, expired, revoked, or replayed sessions return `401 AUTH_SESSION_INVALID`                                       |
| `POST /auth/logout`   | Optional refresh cookie                                                                                        | `204`; refresh cookie cleared                     | Idempotent from the client's perspective; no session is exposed                                                         |

## Protected endpoint

`GET /auth/me` requires `Authorization: Bearer <accessToken>` and returns `{ actor }`. The token is accepted only when its issuer, audience, signature, session ID, and user authentication epoch agree with the current database session.

## Driver self-service endpoints

All driver routes require a valid bearer access token and the `DRIVER` role. The actor ID comes from the authenticated session; there is no caller-controlled driver ID.

| Endpoint                                 | Purpose                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| `GET /drivers/me/profile`                | Read the actor's driver profile.                      |
| `PUT /drivers/me/profile`                | Set optional phone number.                            |
| `GET /drivers/me/vehicles`               | List the actor's non-retired vehicles.                |
| `POST /drivers/me/vehicles`              | Add a vehicle in `PENDING` review state.              |
| `DELETE /drivers/me/vehicles/:vehicleId` | Retire only a vehicle owned by the actor.             |
| `GET /drivers/me/eligibility`            | Return the current eligibility projection and reason. |

Driver registration creates a pending profile. Adding a vehicle does not select it, approve it, put the driver online, or make the driver dispatch-eligible.

## Verified locally

The API integration suite exercises concurrent Driver registration with one idempotency key, idempotent replay, login, authenticated identity read, refresh rotation, logout, rejected post-logout refresh, and rejection of public operator registration. The suite ran successfully with 26 API tests on 2026-09-24.
