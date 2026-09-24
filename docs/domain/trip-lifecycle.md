# Trip Lifecycle

Status: Partially tested
Last updated: 2026-09-24

## Trip states

| State                 | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `REQUESTED`           | A valid Trip exists but dispatch has not started.                         |
| `MATCHING`            | Dispatch may create and expire Trip Offers.                               |
| `DRIVER_TO_PICKUP`    | One Driver accepted and is traveling to Pickup.                           |
| `AT_PICKUP`           | The assigned Driver reported arrival at Pickup.                           |
| `IN_PROGRESS`         | Transportation started with Customer authorization.                       |
| `COMPLETED`           | Transportation ended; the Trip is immutable except settlement references. |
| `CANCELLED`           | An authorized actor cancelled under an applicable rule.                   |
| `NO_DRIVER_AVAILABLE` | Dispatch exhausted the configured search policy without assignment.       |

`OFFER_EXPIRED`, `DRIVER_REASSIGNED`, and `FAILURE` are not Trip states. Expiry belongs to Trip Offer, reassignment is a sequence of reservation and offer outcomes, and technical failure leaves durable business state unchanged unless a defined transition succeeds.

## Allowed transitions

| From               | To                    | Initiator                              | Guard                                                                   |
| ------------------ | --------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `REQUESTED`        | `MATCHING`            | System                                 | Valid Fare Quote snapshot and idempotent creation completed             |
| `REQUESTED`        | `CANCELLED`           | Customer or Operator                   | Matching has not started; reason supplied                               |
| `MATCHING`         | `DRIVER_TO_PICKUP`    | Driver through Dispatch                | Pending unexpired offer; Driver Reservation held; expected Trip version |
| `MATCHING`         | `NO_DRIVER_AVAILABLE` | System                                 | Search policy exhausted and no active reservation remains               |
| `MATCHING`         | `CANCELLED`           | Customer or Operator                   | No accepted assignment; reason supplied                                 |
| `DRIVER_TO_PICKUP` | `AT_PICKUP`           | Assigned Driver                        | Driver still owns assignment; expected Trip version                     |
| `DRIVER_TO_PICKUP` | `MATCHING`            | System or Operator                     | Assignment released under the reassignment policy; prior offer revoked  |
| `DRIVER_TO_PICKUP` | `CANCELLED`           | Customer or Operator                   | Actor-specific cancellation rule; reason supplied                       |
| `AT_PICKUP`        | `IN_PROGRESS`         | Assigned Driver                        | Customer confirmation policy satisfied; expected Trip version           |
| `AT_PICKUP`        | `CANCELLED`           | Customer, assigned Driver, or Operator | Actor-specific cancellation rule; reason supplied                       |
| `IN_PROGRESS`      | `COMPLETED`           | Assigned Driver                        | Dropoff data valid; expected Trip version                               |
| `IN_PROGRESS`      | `CANCELLED`           | Operator only in MVP                   | Exceptional reason and audit record                                     |

Terminal states are `COMPLETED`, `CANCELLED`, and `NO_DRIVER_AVAILABLE`.

## Trip Offer states

`PENDING` may transition to exactly one of `ACCEPTED`, `REJECTED`, `EXPIRED`, or `REVOKED`. Acceptance and expiry contend in one database transaction. A Driver Reservation has the same expiry and is released for every non-accepted terminal outcome.

## Driver Work States

- `OFFLINE`: not eligible for matching.
- `AVAILABLE`: eligible only with a fresh Latest Location and valid Driver/Vehicle eligibility.
- `RESERVED`: exclusively held by one pending Trip Offer.
- `TO_PICKUP`: committed to one assignment before Trip start.
- `ON_TRIP`: serving one Trip in progress.

Suspension belongs to Driver Eligibility. A suspended Driver is ineligible regardless of Driver Work State; it is not another work state.

## Driver Reservation states

`ACTIVE` transitions to exactly one of `COMMITTED`, `RELEASED`, or `EXPIRED`. Committing a Reservation moves Driver Work State from `RESERVED` to `TO_PICKUP`. Starting the Trip moves it to `ON_TRIP`.

## Assignment lifecycle

An Assignment is created as `ACTIVE` when an offer is accepted. It transitions exactly once to `COMPLETED`, `CANCELLED`, or `RELEASED`. `RELEASED` is permitted only before the Trip starts and records a reassignment reason.

Reassignment is one database transaction: verify the expected Trip and Assignment versions, move the active Assignment to `RELEASED`, move Driver Work State from `TO_PICKUP` to `AVAILABLE`, move the Trip from `DRIVER_TO_PICKUP` to `MATCHING`, and append outbox records. Cancellation with an active Assignment uses the same boundary and ends the Assignment before releasing the Driver. No module may perform only its half of either operation.

## Invariants

1. A Driver has at most one active Driver Reservation or Assignment.
2. A Trip has at most one accepted Trip Offer.
3. A state transition compares and increments the Trip version atomically.
4. The assigned Driver cannot change through direct mutation; reassignment requires releasing the prior assignment under a defined policy.
5. Every accepted command records actor, timestamp, previous state, next state, and correlation ID.
6. Live events carry Trip ID and version; clients discard older or duplicate versions.

## Customer cancellation

The implemented Customer command is `POST /api/v1/trips/:tripId/cancel`. It
accepts only a Customer who owns the Trip, requires an idempotency key and
records a reason. It is currently allowed from `REQUESTED`, `MATCHING`,
`DRIVER_TO_PICKUP`, and `AT_PICKUP`; `IN_PROGRESS` and terminal states are
rejected. The command records `CANCEL_TRIP`, advances the Trip version, writes
one `trip.cancellations` audit record, and appends `trip.cancelled` in the same
database transaction. The MVP rule does not create or alter a payment attempt
or cancellation fee.

The current repository implementation also contains cleanup paths. From
`MATCHING`, it revokes pending Offers, releases active Reservations, and returns
the reserved Driver to `AVAILABLE`. From `DRIVER_TO_PICKUP` or `AT_PICKUP`, it
cancels the active Assignment and returns its Driver from `TO_PICKUP` to
`AVAILABLE`. These paths are implementation evidence only at present: their
integration, race, and invariant tests are still pending. The same caution
applies to cancellation racing an offer acceptance, offer expiry, reassignment,
arrival, or Trip start.

Driver-initiated and Operator-initiated Ride cancellation are not implemented.
Neither Customer nor Driver frontend/browser cancellation flow is verified.

## Implemented evidence

The pure Trip transition function and its transition matrix are implemented in
`apps/api/src/trip/domain`. M0 verifies allowed transitions, version
increments, terminal-state rejection, and invalid commands. M3/M4 integration
tests verify persistence, authorization, assignment acceptance, realtime
events, and reconnect snapshots. M5 integration tests verify the Driver-owned
`AT_PICKUP → IN_PROGRESS → COMPLETED` path, duplicate completion, final fare
calculation, and Driver Work State restoration.

The Trip integration suite verifies Customer-owned `REQUESTED → CANCELLED` and
idempotent replay of the same cancellation command. It does not yet prove
matching/assigned cleanup, idempotency-key reuse with changed input, terminal
state rejection, realtime delivery/reconnect, or cancellation races.
