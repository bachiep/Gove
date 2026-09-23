# Fare Quote and Ride Request API

Status: Implemented and tested locally
Last updated: 2026-09-24

Both commands require a Customer bearer token and an `Idempotency-Key` with 8–128 characters. The server owns distance estimation, quote expiry, pricing, and Trip state; clients do not submit an amount, duration, or lifecycle state.

## `POST /api/v1/pricing/fare-quotes`

Creates an `ACTIVE` Fare Quote from `pickup`, `dropoff`, and `serviceType`. Each location has a demo label, latitude, and longitude. Coordinates must lie inside the configured synthetic demo rectangle and points must differ.

The response includes a quote ID, service type, normalized input locations, estimated straight-line distance/duration, currency, estimated total, and server expiry. It does not include a route, Driver, ETA, or final fare. A matching idempotency retry replays the same quote; reusing its key with changed input returns `409 IDEMPOTENCY_KEY_REUSED`.

## `POST /api/v1/trips`

Accepts `{ "fareQuoteId": "uuid" }` and creates one Trip in `REQUESTED` state. The command locks the quote and verifies that it belongs to the authenticated Customer, is active, and has not expired. It copies the quote snapshot into the Trip, marks the quote consumed, records the initial transition, and writes `trip.created` to the outbox in one transaction.

A matching retry replays the same Trip response. A competing command against an already consumed quote returns `409 FARE_QUOTE_ALREADY_CONSUMED`; expired quotes return `422 FARE_QUOTE_EXPIRED`; a quote not owned by the Customer is not exposed.

## Verified locally

The M2 HTTP suite covers quote replay, idempotent concurrent Trip creation, competing quote consumption, and outside-service-area rejection. The pricing unit suite covers deterministic integer calculation, rounding, surge bounds, invalid inputs, and snapshot isolation.
