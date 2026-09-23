# ADR-0009: Model Delivery as a Separate Aggregate

Status: Accepted
Date: 2026-09-24

## Context

Ride transport and parcel logistics share geography, Driver supply, pricing,
and dispatch concerns, but they differ at the business boundary. A Trip carries
a Customer; a Delivery transfers a Parcel to a Recipient and needs custody and
proof semantics. Reusing the Trip table or only renaming Trip endpoints would
erase those invariants and make future delivery requirements unsafe to add.

## Decision

Create Delivery as a separate aggregate with its own lifecycle, version,
ownership, outbox events, and public contracts. The first M7 product is one
parcel, one Pickup, one Dropoff, and one Recipient. Existing Driver eligibility
and exclusive Dispatch reservation principles may be reused through a defined
adapter, but Delivery must not write Trip-owned tables or reinterpret a Trip
state as a delivery state.

The first proof is a minimal non-media confirmation. Media proof, delivery
recipient authentication, multi-stop routing, and real settlement are deferred
until their privacy and operational requirements are designed.

## Alternatives considered

1. Rename Trip to Order: rejected because it conflates passenger transport and
   parcel custody, breaking both ubiquitous language and lifecycle rules.
2. Add nullable parcel and recipient columns to Trip: rejected because the
   aggregate would have mutually exclusive invariants and an increasingly
   ambiguous API.
3. Build Delivery as an independent microservice immediately: deferred because
   the existing modular monolith preserves ownership and transactional seams
   without introducing a distributed dispatch transaction prematurely.

## Consequences

M7 requires dedicated schema, contracts, API, tests, and UI surfaces. Dispatch
must evolve from Trip-specific records to an explicit shared reservation seam
without weakening the existing concurrent Trip acceptance proof. Delivery does
not become implemented merely by accepting a Delivery Request; its custody,
proof, and terminal-state invariants need automated evidence.
