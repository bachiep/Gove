# Data Ownership

Status: Designed
Last updated: 2026-09-24

One PostgreSQL cluster is used initially, but tables and writes remain module-owned. Cross-module reads use module interfaces or explicit read projections; callers do not update another module's tables.

| Data                                                                                | Owner            | Other modules receive                                                       |
| ----------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| User, credential, role, refresh session                                             | Identity         | Actor ID and authorized roles                                               |
| Driver profile, Vehicle, and eligibility                                            | Driver           | Driver ID and eligibility result                                            |
| Latest Location and freshness                                                       | Location         | Nearby candidate IDs and location projection                                |
| Pricing rule and Fare Quote                                                         | Pricing          | Quote ID, expiry, rule version, amount breakdown                            |
| Trip, transition history, assignment reference                                      | Trip             | Trip snapshot and versioned domain events                                   |
| Dispatch Request, Driver Work State, Driver Reservation, Trip Offer, and Assignment | Dispatch         | Candidate demand, work-state result, assignment result, and dispatch events |
| Payment Attempt and reconciliation state                                            | Payment          | Settlement result and versioned events                                      |
| Notification Delivery Attempt and live subscription                                 | Notification     | Delivery status only                                                        |
| Outbox record                                                                       | Producing module | Immutable event envelope                                                    |

## Transaction rule

Assignment acceptance, reassignment, and cancellation require atomic changes across Trip and Dispatch-owned records plus eligibility checks from Driver where applicable. The application transaction coordinator invokes each module through an internal interface under one database transaction; it must not embed their state-transition rules or write their tables directly. Every successful boundary writes its outbox records in that transaction. A failed boundary leaves the Trip, Assignment, Reservation, and Driver Work State unchanged.

## Redis rule

Redis may hold Latest Location geo entries, connection routing, short-lived rate-limit counters, and pub-sub messages. Every entry has an owner, TTL where applicable, and a rebuild or degradation strategy. Redis never authorizes a Trip transition, proves payment, or becomes the only copy of a Driver assignment.
