# Delivery Lifecycle

Status: Partially implemented and tested locally
Last updated: 2026-09-24

Delivery is a separate logistics aggregate. It may reuse a Driver, Pickup,
Dropoff, geographic value types, and later Dispatch capabilities, but it is
not a renamed Trip: it has a Parcel, a Recipient, custody transfer, and proof
of delivery.

## States

| State                 | Meaning                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `REQUESTED`           | Customer created a valid one-pickup, one-dropoff delivery request.             |
| `MATCHING`            | Dispatch may consider eligible Drivers for the Delivery.                       |
| `DRIVER_TO_PICKUP`    | One Driver accepted a Delivery assignment and is traveling to its Pickup.      |
| `AT_PICKUP`           | The assigned Driver reported arrival at Pickup.                                |
| `IN_TRANSIT`          | Parcel custody was confirmed at Pickup and the Driver is traveling to Dropoff. |
| `DELIVERED`           | Recipient handoff and Delivery Proof were recorded.                            |
| `CANCELLED`           | An authorized actor cancelled under a defined rule.                            |
| `NO_DRIVER_AVAILABLE` | Matching exhausted its search policy without an accepted assignment.           |

Terminal states are `DELIVERED`, `CANCELLED`, and `NO_DRIVER_AVAILABLE`.

## Essential transitions

| From               | To                 | Initiator               | Guard                                                             |
| ------------------ | ------------------ | ----------------------- | ----------------------------------------------------------------- |
| `REQUESTED`        | `MATCHING`         | System                  | Valid parcel, recipient, and distinct Pickup/Dropoff exist.       |
| `MATCHING`         | `DRIVER_TO_PICKUP` | Driver through Dispatch | Pending unexpired Delivery Offer and exclusive reservation exist. |
| `DRIVER_TO_PICKUP` | `AT_PICKUP`        | Assigned Driver         | Active Delivery assignment exists.                                |
| `AT_PICKUP`        | `IN_TRANSIT`       | Assigned Driver         | Pickup custody confirmation is present.                           |
| `IN_TRANSIT`       | `DELIVERED`        | Assigned Driver         | Recipient handoff and required Delivery Proof are present.        |

Expiry, version checks, command receipts, and outbox writes follow the same
correctness principles as ride Dispatch, but use Delivery-owned records and
Delivery versioning. `CANCELLED` is reserved in the state model; cancellation
commands and rules are deferred from the frozen first Delivery slice and must
not be presented as implemented. Reassignment is also deferred; an expired
offer currently closes the Delivery as `NO_DRIVER_AVAILABLE`.

## M7 proof boundary

The first parcel slice records bounded pickup custody and recipient proof text;
it does not store photos, signatures, or identity documents. A later photo or
signature design requires retention, access-control, encryption, and privacy
decisions before implementation.
