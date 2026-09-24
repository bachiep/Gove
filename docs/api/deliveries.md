# Delivery API

Status: Partially implemented and tested locally
Last updated: 2026-09-24

The M7 Delivery boundary is independent of `/trips`. It uses the same bearer
authentication and structured API error model, but its durable records, command
receipts, state transitions, and outbox are Delivery-owned.

## Implemented foundation

### `POST /api/v1/deliveries`

Requires a Customer bearer token and an `Idempotency-Key`. The request contains
one Pickup, one Dropoff, a Recipient display name/contact phone, and a Parcel
description/declared weight. The response is a `REQUESTED` Delivery at version
zero. The recipient phone is stored as operational data but is not returned by
this response.

Reusing the same key with the same request returns the original Delivery.
Reusing it with a different request returns `409 IDEMPOTENCY_KEY_REUSED`.

### `GET /api/v1/deliveries/:deliveryId`

Requires the Customer owner. A Delivery that does not exist or is not owned by
the caller returns `404 DELIVERY_NOT_FOUND`; this avoids ownership disclosure.

### `POST /api/v1/deliveries/:deliveryId/match`

Requires the Customer owner and an `Idempotency-Key`. It transitions a
`REQUESTED` Delivery to `MATCHING`, then locks the shared Driver work-state row
while creating a Delivery-owned reservation and offer. A Driver can therefore
not receive a Trip and Delivery reservation at the same time. No eligible
Driver produces `NO_DRIVER_AVAILABLE`.

### `POST /api/v1/delivery-offers/:offerId/accept`

Requires the offered Driver and an `Idempotency-Key`. It commits the
Delivery-owned reservation/assignment and transitions the Delivery to
`DRIVER_TO_PICKUP` in one transaction. Pending offers expire after 20 seconds;
the in-process expiry worker releases the shared Driver work state and closes
the Delivery as `NO_DRIVER_AVAILABLE` when no retry is implemented.

### Driver delivery lifecycle

The assigned Driver uses an `Idempotency-Key` for each command:

- `POST /api/v1/deliveries/:deliveryId/arrive` moves
  `DRIVER_TO_PICKUP` to `AT_PICKUP`.
- `POST /api/v1/deliveries/:deliveryId/pickup` requires a 1–120 character
  `custodyConfirmation` and moves `AT_PICKUP` to `IN_TRANSIT`.
- `POST /api/v1/deliveries/:deliveryId/complete` requires a 1–120 character
  `recipientProof` and moves `IN_TRANSIT` to `DELIVERED`.

The proof is bounded confirmation text, not a photo, signature, or identity
document. Completion writes proof, closes the assignment, releases the shared
Driver work state, records a versioned state transition, and writes an outbox
event in one transaction.

## Not implemented yet

Driver/customer status projections, history, payment, realtime Delivery
projections, offer retry/reassignment, cancellation rules, and PWA screens
remain M7 work. They must use Delivery records rather than changing Trip
semantics.
