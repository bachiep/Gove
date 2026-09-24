# Delivery API

Status: Implemented and tested locally
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

### `GET /api/v1/deliveries`

Requires a Customer bearer token. It returns only Deliveries owned by that
Customer, newest first, using the same privacy-safe response projection.

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

### `GET /api/v1/delivery-assignments/:deliveryId`

Requires the assigned Driver. It returns the current durable Delivery status
projection without the recipient contact phone. A Delivery not assigned to the
caller returns `404 DELIVERY_NOT_FOUND`, avoiding assignment disclosure.

### Driver dispatch projections

- `GET /api/v1/delivery-offers/me` lists pending Delivery Offers for the
  authenticated Driver.
- `GET /api/v1/delivery-assignments/current` returns that Driver's active
  Delivery or `null`.

Both projections are derived from durable Delivery offer/assignment records;
the PWA must not infer them from client-side state.

## Customer UI and realtime projection

The Customer PWA exposes Delivery creation, current status, history, and
detail views. `GET /api/v1/deliveries/active` returns all non-terminal
Deliveries owned by the Customer so the view can resume after refresh. The
array is intentional because this scope does not impose a one-active-Delivery
invariant. After a Delivery is created, the view authenticates to `/ws`,
subscribes with `deliveryIds`, applies the authoritative
`delivery.snapshot`, and accepts only newer `delivery.event` state/version
payloads. The HTTP record remains the authoritative fallback on a refresh or
reconnect; the PWA does not change Trip semantics or infer Delivery state from
client-only data.

The gateway authorizes the Customer owner, assigned Driver, and a Driver with a
pending or accepted Offer before it emits a snapshot. Matching, assignment,
custody, handoff, completion, and no-Driver outcome events are appended to the
Delivery transactional outbox in the same transaction as their durable state
transition. See [Realtime API](realtime.md) for the wire contract and
[browser acceptance evidence](../testing/browser-acceptance-2026-09-25.md)
for the locally observed Customer flow and local synthetic Customer-and-Driver
custody flow through `DELIVERED`.

## Deferred work

Payment, offer retry/reassignment, cancellation rules, and proof media are
explicitly outside the frozen first Delivery slice. Adding any of them later
requires its own rules, idempotency behavior, authorization, and acceptance
evidence.
