# Data Ownership

Status: Tested locally
Last updated: 2026-09-24

One PostgreSQL cluster is used initially, but tables and writes remain module-owned. Cross-module reads use module interfaces or explicit read projections; callers do not update another module's tables.

| Data                                                                                | Owner            | Other modules receive                                                       |
| ----------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| User, credential, role, refresh session                                             | Identity         | Actor ID and authorized roles                                               |
| Driver profile, Vehicle, and eligibility                                            | Driver           | Driver ID and eligibility result                                            |
| Latest Location and freshness                                                       | Location         | Nearby candidate IDs and location projection                                |
| Pricing rule and Fare Quote                                                         | Pricing          | Quote ID, expiry, rule version, amount breakdown                            |
| Trip, transition history, completion metering, and final fare                       | Trip             | Trip detail snapshot and versioned domain events                            |
| Dispatch Request, Driver Work State, Driver Reservation, Trip Offer, and Assignment | Dispatch         | Candidate demand, work-state result, assignment result, and dispatch events |
| Payment Attempt, command receipt, and settlement outbox                             | Payment          | Settlement result and versioned events                                      |
| Notification Delivery Attempt and live subscription                                 | Notification     | Delivery status only                                                        |
| Outbox record                                                                       | Producing module | Immutable event envelope                                                    |

## Transaction rule

Assignment acceptance, reassignment, and cancellation require atomic changes across Trip and Dispatch-owned records plus eligibility checks from Driver where applicable. The application transaction coordinator invokes each module through an internal interface under one database transaction; it must not embed their state-transition rules or write their tables directly. Every successful boundary writes its outbox records in that transaction. A failed boundary leaves the Trip, Assignment, Reservation, and Driver Work State unchanged.

## Redis rule

Redis may hold Latest Location geo entries, connection routing, short-lived rate-limit counters, and pub-sub messages. Every entry has an owner, TTL where applicable, and a rebuild or degradation strategy. Redis never authorizes a Trip transition, proves payment, or becomes the only copy of a Driver assignment.

## Realtime read projection

Realtime is a delivery adapter, not a business-entity owner. Its read-only
snapshot query may compose Trip, Dispatch, and Location-owned rows into one
`TripRealtimeSnapshot` because a reconnect requires a consistent customer-facing
view. The query does not write those tables or reimplement their state
transitions; commands continue to use the owning module interfaces and
transactions. If this projection becomes a scaling boundary, it must move to an
explicit versioned read model rather than adding cross-module writes.

## Completion and settlement boundary

Dispatch is the transaction coordinator for Driver lifecycle commands because
it owns the active Assignment and Driver Work State. Trip owns completion
metering and final fare fields; the fare is calculated from the immutable quote
snapshot by the Pricing policy. Payment owns attempts and payment command
receipts. History reads compose these owned records without allowing a caller
to write another module's tables.
