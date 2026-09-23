# Vertical Slice 06 — Delivery Foundation

Status: Partially implemented and tested locally
Last updated: 2026-09-24

## Scope completed

This first M7 implementation establishes Delivery as an independent durable
aggregate. A Customer can create an idempotent one-pickup/one-dropoff parcel
Delivery and read it only when they own it. PostgreSQL records an initial state
transition and `delivery.created` outbox event in the same transaction.

## Evidence

- `0007-delivery-foundation.sql` creates Delivery tables without modifying Trip
  tables or Trip state values.
- HTTP integration tests verify concurrent same-key create replay and Customer
  ownership/IDOR behavior.
- API and contracts typechecks pass for this foundation.

## Remaining M7 path

```text
Delivery Request
  → Delivery matching and exclusive Driver reservation
  → Driver accepts
  → Pickup custody confirmation
  → Recipient proof and Delivery completion
  → Rebuildable realtime status and Customer/Driver PWA flows
```

The existing Dispatch schema is Trip-specific, so the next slice must introduce
an explicit shared reservation/assignment seam instead of attaching Delivery
to Trip-only foreign keys.
