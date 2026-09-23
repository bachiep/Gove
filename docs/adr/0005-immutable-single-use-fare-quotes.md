# ADR 0005: Persist immutable single-use Fare Quotes

Status: Accepted
Date: 2026-09-24

## Context

Pricing rules change over time, while a Trip must be explainable using the price the Customer accepted. Creating a Trip from an expired or already used quote would make price and state ambiguous under retry or concurrency.

## Decision

Create an expiring Fare Quote with a complete immutable pricing-rule snapshot and price breakdown. The server evaluates quote validity. A Fare Quote is owned by one Customer and has one of `ACTIVE`, `CONSUMED`, `EXPIRED`, or `INVALIDATED` status. Trip creation locks the quote, copies its snapshot to the Trip, and changes it to `CONSUMED` in the same transaction. `trip.fare_quote_id` is unique.

## Consequences

- A Trip can show the quote and rules used even after future rate-card changes.
- Retrying the same Trip command safely returns the original result instead of consuming another quote.
- Quote and Trip rows duplicate some price and location data intentionally for audit locality.
- The first implementation uses deterministic estimates, not road-network distance or real-time supply pricing; these limitations must be visible in the UI and documentation.

## Alternatives considered

1. **Recalculate on Trip creation** — rejected because rule changes could alter the accepted price.
2. **Allow unlimited Trips per quote** — rejected because it duplicates customer intent and creates settlement ambiguity.
3. **Store only a rate-card reference** — rejected because later rule edits or removal weaken auditability.
