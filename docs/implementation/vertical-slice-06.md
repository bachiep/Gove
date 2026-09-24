# Vertical Slice 06 — Parcel Delivery

Status: Implemented and tested locally
Last updated: 2026-09-24

## Scope completed

This M7 implementation establishes Delivery as an independent durable
aggregate. A Customer can create/read a one-pickup/one-dropoff parcel Delivery
and start matching; a Driver can idempotently accept its offer, arrive at
Pickup, confirm custody, and complete recipient handoff with a bounded text
proof. PostgreSQL records state transitions in the same transaction as each
state change.

The Driver Console now polls the Delivery offer/current-assignment projections
and exposes accept, arrival, custody, and recipient handoff commands. It asks
the Driver to enter bounded confirmation text; it does not fabricate proof.

The Customer PWA now creates a Delivery, starts matching, displays its
authoritative status/history/detail, and opens an authenticated WebSocket
subscription for `delivery.snapshot` and `delivery.event`. Snapshot and event
versions prevent an older realtime message from overwriting newer Customer
state.

## Evidence

- `0007-delivery-foundation.sql` creates Delivery tables without modifying Trip
  tables or Trip state values.
- `0008-delivery-dispatch.sql` adds Delivery-owned reservation, offer, and
  assignment records. It extends—not replaces—the shared Driver work state so
  a Driver is bound to exactly one active Trip _or_ Delivery.
- HTTP integration tests verify create replay, Customer ownership/IDOR,
  concurrent accept replay, concurrent competing Delivery matching, concurrent
  Trip-versus-Delivery matching, offer expiry release, custody replay, proof
  validation, completion replay, and Driver assignment ownership.
- Realtime integration tests verify an authorized Customer receives a Delivery
  snapshot and committed matching event through `/ws`.
- A local browser run verifies Customer Delivery creation, the
  `NO_DRIVER_AVAILABLE` outcome, history/detail access, and a synthetic
  Customer-and-Driver custody lifecycle through `DELIVERED`; no horizontal
  overflow was observed at a 375 px viewport. GPS permission, reconnect and
  external route/provider behavior remain outside this evidence.
- API and contracts typechecks pass for this slice.

## Remaining M7 verification path

```text
Customer creates Delivery
  → Driver accepts offer
  → Driver records arrival, custody, and recipient handoff
  → Customer observes final authoritative status in browser
```

Offer expiry releases the Driver and currently closes the Delivery with
`NO_DRIVER_AVAILABLE`. Bounded retry/reassignment is intentionally deferred;
it must remain Delivery-owned rather than attaching Delivery to Trip-only
foreign keys.

Delivery payment, cancellation, multi-stop routing, cash collection, and proof
media are outside the frozen first slice. Their absence does not block M7. The
path above has been observed locally with synthetic identities. It remains
`Partial` as a release gate because browser GPS permission, reconnect after
reload, accessibility review, and external deployment have not been verified.
The remaining gates are verification work, not an unimplemented UI or
realtime-contract capability.
