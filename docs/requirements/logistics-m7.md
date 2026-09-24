# M7 Logistics Requirements

Status: Partially implemented and tested locally
Last updated: 2026-09-24

## First delivery product

The first logistics slice is a general parcel delivery with exactly one Pickup,
one Dropoff, one Recipient, and one Parcel manifest. Food delivery, multi-stop
routing, return-to-sender, cold-chain handling, and cash collection are out of
scope for this slice.

This product boundary is accepted and frozen for academic completion. Payment,
cancellation, retry/reassignment, proof photos/signatures, and background
tracking are not required for this first Delivery slice.

## Functional requirements

| ID   | Requirement                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| L-01 | A Customer can create a Delivery Request with Pickup, Dropoff, Recipient, and Parcel manifest.                       |
| L-02 | Delivery remains a durable aggregate separate from Trip and has its own versioned lifecycle.                         |
| L-03 | A Delivery assignment reserves no more than one Driver at a time and cannot compete unsafely with a Trip assignment. |
| L-04 | The assigned Driver records arrival, pickup custody confirmation, and recipient handoff.                             |
| L-05 | Delivery completion requires a privacy-bounded Delivery Proof.                                                       |
| L-06 | Customer and assigned Driver receive a rebuildable Delivery status projection.                                       |
| L-07 | Duplicate create, accept, custody, and completion commands are idempotent.                                           |
| L-08 | Authorization prevents a Customer or Driver from reading another Delivery or its recipient details.                  |

## Acceptance scenarios

1. A Customer can create one idempotent Delivery without creating a Trip.
2. A Driver already reserved or assigned to a Trip cannot accept a Delivery.
3. Duplicate pickup and delivery completion commands return the original result.
4. Delivery cannot transition to `DELIVERED` without both custody confirmation and Delivery Proof.
5. Customer A cannot access Customer B's Delivery or recipient details.

## Implementation status

| Requirement | Current status                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| L-01        | Backend create/read/history and idempotency are tested; Customer creation UI remains.                                     |
| L-02        | Separate schema, transitions, versioning, receipts, outbox, and ADR are implemented.                                      |
| L-03        | Shared Driver work state and Delivery contention tests exist; an explicit Trip-versus-Delivery race gate remains.         |
| L-04–05     | Driver lifecycle, bounded custody/proof, and Driver Console are implemented and tested locally; browser evidence remains. |
| L-06        | Customer history and Driver offer/current-assignment HTTP projections exist; Delivery realtime remains.                   |
| L-07–08     | Replay and ownership tests exist for implemented commands and projections.                                                |

M7 exits only when Customer UI, rebuildable realtime status, cross-domain
contention evidence, and browser acceptance are complete.
