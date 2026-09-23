# Completion and Settlement API

Status: Tested locally
Last updated: 2026-09-24

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

## Payment simulator

`POST /api/v1/payments/trips/:tripId/capture` is Customer-only and accepts:

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

`GET /api/v1/payments/trips/:tripId` is available to the Customer and assigned
Driver. Unauthorized ownership returns a not-found response to avoid exposing
resource existence.

## History

`GET /api/v1/trips/history` returns terminal trips visible to the current
Customer or Driver, including final fare, completion fields, assignment Driver
ID, and the latest Payment Attempt status. It is a read-only projection and
does not mutate payment or Trip state.
