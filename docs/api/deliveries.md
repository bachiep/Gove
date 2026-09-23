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

## Not implemented yet

Matching, Delivery Offers, Driver pickup custody, recipient proof, delivery
completion, Driver reads, history, payment, realtime Delivery projections, and
PWA screens remain M7 work. They must use Delivery records rather than changing
Trip semantics.
