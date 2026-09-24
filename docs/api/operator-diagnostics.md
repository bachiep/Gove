# Operator Diagnostics API

Status: Implemented and tested locally

Last updated: 2026-09-25

The Operator boundary contains two narrow capabilities: PII-minimized Trip
diagnostics and auditable Driver onboarding review. It does not expose
Customer/Driver identity, locations, payment data, or historic free-text audit
reasons in the Trip timeline projection.

## `GET /api/v1/operator/trips/:tripId/timeline`

Requires an authenticated `OPERATOR`. It returns the Trip identifier, current
state/version, versioned transition metadata, and audit summaries. A missing
Trip returns `404 TRIP_NOT_FOUND`; the endpoint does not accept a Customer or
Driver token.

The transition timeline retains command, state/version transition, correlation
ID, and timestamp. It intentionally omits actor IDs, Pickup/Dropoff, Driver
location, payment data, and audit reason text.

## `POST /api/v1/operator/trips/:tripId/diagnostic-reviews`

Requires an authenticated `OPERATOR` and a JSON body:

```json
{ "reason": "Explain why this Trip needs an operational review." }
```

`reason` is trimmed and must contain 3–240 characters. The command stores an
`audit.operator_diagnostic_actions` row with the Operator ID, Trip ID, action,
reason, correlation ID, and timestamp. The successful response returns the
new audit ID and reason to the initiating Operator; later timeline reads return
only a PII-minimized audit summary.

## Verification boundary

The integration suite verifies unauthenticated rejection, non-Operator
rejection, validation, missing-Trip behavior, PII-minimized timeline output,
and durable audit persistence. This is a local implementation claim; browser
Operator workflow evidence is still required by the final acceptance gate.

## Driver onboarding review

The following endpoints require an authenticated `OPERATOR`:

```text
POST /api/v1/operator/drivers/:driverUserId/approve
POST /api/v1/operator/drivers/:driverUserId/reject
POST /api/v1/operator/drivers/:driverUserId/vehicles/:vehicleId/approve
POST /api/v1/operator/drivers/:driverUserId/vehicles/:vehicleId/reject
```

Each request accepts `{ "reason": "..." }`, trimmed to 3–240 characters,
and requires an `Idempotency-Key` header with 8–128 characters. The server
stores the response receipt transactionally with the status update and audit
row. Repeating the same operation with the same key and payload replays the
original approval response without creating another audit row; reusing the
key for the same operation with a different subject or reason returns
`409 IDEMPOTENCY_KEY_REUSED`.
Only `PENDING` subjects can be reviewed. Driver approval requires a phone
number; Vehicle approval requires an approved Driver profile and selects that
Vehicle. Vehicle rejection clears `is_selected`. A mismatched Driver/Vehicle
ownership query returns `404`, and a second review returns `409`.

The status update, `driver.onboarding_approval_actions` audit row, and
idempotency receipt are written in one PostgreSQL transaction. The current API
has no pending-review list endpoint; that remains explicit follow-up work.

Integration coverage verifies Operator authorization, approval, rejection,
reason validation, ownership protection, second-review conflict, and durable
status/audit persistence. Browser Operator workflow evidence is still absent.
