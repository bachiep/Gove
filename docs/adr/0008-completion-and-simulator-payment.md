# ADR-0008: Complete Trips from Observed Metering and Simulate Settlement

Status: Accepted
Date: 2026-09-24

## Context

The first vertical slice reached Driver assignment and realtime status, but it
did not have a durable completion boundary or a way to demonstrate settlement.
The final fare must use the immutable pricing rule snapshot captured by the
Fare Quote, while the payment flow must remain safe to retry without claiming
that a real provider is integrated.

## Decision

- Dispatch owns the assigned Driver lifecycle commands: arrival, start, and
  completion. Each command is authorized by the active Assignment and uses a
  PostgreSQL transaction, expected state, and an idempotency receipt.
- Completion stores observed distance, observed duration, final fare, and
  completion time on the Trip. The fare is calculated from the Trip's immutable
  quote snapshot and bounded integer metering input.
- Assignment is a durable Dispatch-owned record. Acceptance creates it in the
  same transaction that commits the offer, reservation, Driver Work State, and
  Trip transition.
- Payment owns Payment Attempts, command receipts, and payment outbox records.
  The simulator exposes `SUCCEEDED`, `FAILED`, `PENDING`, and `UNKNOWN` outcomes.
  A pending, succeeded, or unknown attempt blocks a new capture until its state
  is resolved; failed attempts may be retried with a new idempotency key.
- Customer and Driver history is a read-only Trip projection. PostgreSQL stays
  the source of truth; the PWA uses REST history and the existing WebSocket
  Trip projection.

## Alternatives considered

1. Let the Customer mark a Trip completed: rejected because the assigned Driver
   is the actor that observes the operational completion and metering.
2. Recalculate final fare from current pricing rules: rejected because a later
   rule change would alter an already quoted Trip.
3. Integrate a real payment provider now: rejected because credentials,
   provider contracts, and financial reconciliation are outside the current
   academic/demo scope.

## Consequences

The M5 vertical slice is demonstrable and concurrency-testable. A real payment
provider, reconciliation command, cancellation policy, and road-network meter
remain explicit follow-up work. The simulator is not a production payment
implementation.
