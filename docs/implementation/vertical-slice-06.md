# Vertical Slice 06 — Delivery Foundation

Status: Partially implemented and tested locally
Last updated: 2026-09-24

## Scope completed

This M7 implementation establishes Delivery as an independent durable
aggregate. A Customer can create/read a one-pickup/one-dropoff parcel Delivery,
start matching, and a Driver can idempotently accept its offer. PostgreSQL
records state transitions in the same transaction as the state change.

## Evidence

- `0007-delivery-foundation.sql` creates Delivery tables without modifying Trip
  tables or Trip state values.
- `0008-delivery-dispatch.sql` adds Delivery-owned reservation, offer, and
  assignment records. It extends—not replaces—the shared Driver work state so
  a Driver is bound to exactly one active Trip _or_ Delivery.
- HTTP integration tests verify create replay, Customer ownership/IDOR,
  concurrent accept replay, and concurrent competing Delivery matching.
- API and contracts typechecks pass for this slice.

## Remaining M7 path

```text
Delivery Request
  → Delivery matching and exclusive Driver reservation
  → Driver accepts
  → Pickup custody confirmation
  → Recipient proof and Delivery completion
  → Rebuildable realtime status and Customer/Driver PWA flows
```

Offer expiry releases the Driver and currently closes the Delivery with
`NO_DRIVER_AVAILABLE`. Bounded retry/reassignment is intentionally deferred;
it must remain Delivery-owned rather than attaching Delivery to Trip-only
foreign keys.
