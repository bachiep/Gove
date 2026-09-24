# Completion and Settlement API

Status: Tested locally
Last updated: 2026-09-25

## Driver lifecycle commands

The assigned Driver calls these endpoints with a bearer token and an
`Idempotency-Key`:

| Endpoint                                       | Required state     | Result        |
| ---------------------------------------------- | ------------------ | ------------- |
| `POST /api/v1/dispatch/trips/:tripId/arrive`   | `DRIVER_TO_PICKUP` | `AT_PICKUP`   |
| `POST /api/v1/dispatch/trips/:tripId/start`    | `AT_PICKUP`        | `IN_PROGRESS` |
| `POST /api/v1/dispatch/trips/:tripId/complete` | `IN_PROGRESS`      | `COMPLETED`   |

The completion body is:

```json
{
  "actualDistanceMeters": 2500,
  "actualDurationSeconds": 420
}
```

The response is a `TripDetailResponse` containing the assignment's Driver ID,
observed metering, final fare, and completion timestamp. A repeated command
with the same actor, operation, key, and request body replays the stored result.

## Payment providers

`POST /api/v1/payments/trips/:tripId/capture` is Customer-only and accepts the
simulator outcome plus an optional provider selected by server configuration.
The default `SIMULATOR` provider accepts:

```json
{ "simulationOutcome": "SUCCEEDED" }
```

The supported outcomes are `SUCCEEDED`, `FAILED`, `PENDING`, and `UNKNOWN`.
The response is a `PaymentAttemptResponse`. The amount comes from the final
Trip fare, not from a client-provided amount.

- `SUCCEEDED`: the attempt is settled and future capture is a conflict.
- `FAILED`: a new idempotency key may create a retry attempt.
- `PENDING`: a new capture is rejected until the attempt is resolved.
- `UNKNOWN`: a new capture is rejected and reconciliation is required.

`MOMO` and `SEPAY` are safe baselines only: they create a `PENDING` attempt
without calling a provider, generating a QR, accepting a webhook, or moving
real money. They currently have no resolution/reconciliation path and must not
be presented as live payment integrations.

`GET /api/v1/payments/trips/:tripId` is available to the Customer, assigned
Driver, and authorized Operator diagnostics role. Customer/Driver ownership is
still checked; Operator access is intentional for operational investigation and
must be protected by the Operator role guard. Unauthorized ownership returns a
not-found response to avoid exposing resource existence.

## History

`GET /api/v1/trips/history` returns terminal trips visible to the current
Customer or Driver, including final fare, completion fields, assignment Driver
ID, and the latest Payment Attempt status. It is a read-only projection and
does not mutate payment or Trip state.
