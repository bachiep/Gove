# Trip Lifecycle

Status: Designed
Last updated: 2026-09-24

## Trip states

| State | Meaning |
| --- | --- |
| `REQUESTED` | A valid Trip exists but dispatch has not started. |
| `MATCHING` | Dispatch may create and expire Trip Offers. |
| `DRIVER_TO_PICKUP` | One Driver accepted and is traveling to Pickup. |
| `AT_PICKUP` | The assigned Driver reported arrival at Pickup. |
| `IN_PROGRESS` | Transportation started with Customer authorization. |
| `COMPLETED` | Transportation ended; the Trip is immutable except settlement references. |
| `CANCELLED` | An authorized actor cancelled under an applicable rule. |
| `NO_DRIVER_AVAILABLE` | Dispatch exhausted the configured search policy without assignment. |

`OFFER_EXPIRED`, `DRIVER_REASSIGNED`, and `FAILURE` are not Trip states. Expiry belongs to Trip Offer, reassignment is a sequence of reservation and offer outcomes, and technical failure leaves durable business state unchanged unless a defined transition succeeds.

## Allowed transitions

| From | To | Initiator | Guard |
| --- | --- | --- | --- |
| `REQUESTED` | `MATCHING` | System | Valid Fare Quote snapshot and idempotent creation completed |
| `MATCHING` | `DRIVER_TO_PICKUP` | Driver through Dispatch | Pending unexpired offer; Driver Reservation held; expected Trip version |
| `MATCHING` | `NO_DRIVER_AVAILABLE` | System | Search policy exhausted and no active reservation remains |
| `MATCHING` | `CANCELLED` | Customer or Operator | No accepted assignment; reason supplied |
| `DRIVER_TO_PICKUP` | `AT_PICKUP` | Assigned Driver | Driver still owns assignment; expected Trip version |
| `DRIVER_TO_PICKUP` | `MATCHING` | System or Operator | Assignment released under the reassignment policy; prior offer revoked |
| `DRIVER_TO_PICKUP` | `CANCELLED` | Customer or Operator | Actor-specific cancellation rule; reason supplied |
| `AT_PICKUP` | `IN_PROGRESS` | Assigned Driver | Customer confirmation policy satisfied; expected Trip version |
| `AT_PICKUP` | `CANCELLED` | Customer, assigned Driver, or Operator | Actor-specific cancellation rule; reason supplied |
| `IN_PROGRESS` | `COMPLETED` | Assigned Driver | Dropoff data valid; expected Trip version |
| `IN_PROGRESS` | `CANCELLED` | Operator only in MVP | Exceptional reason and audit record |

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

## Invariants

1. A Driver has at most one active Driver Reservation or Assignment.
2. A Trip has at most one accepted Trip Offer.
3. A state transition compares and increments the Trip version atomically.
4. The assigned Driver cannot change through direct mutation; reassignment requires releasing the prior assignment under a defined policy.
5. Every accepted command records actor, timestamp, previous state, next state, and correlation ID.
6. Live events carry Trip ID and version; clients discard older or duplicate versions.
