# Vertical Slice 05 — Completion and Simulated Settlement

Status: Tested locally
Last updated: 2026-09-24

## Scope

This slice extends the accepted ride flow through Driver completion, final fare
calculation, simulated payment, and history for the Customer and Driver.

## Implemented path

```text
Accepted assignment
  → Driver arrives at pickup
  → Driver starts trip
  → Driver completes with observed meter values
  → Trip stores final fare from immutable pricing snapshot
  → Customer captures simulator payment
  → Customer and Driver read terminal trip history
```

## API seam

- `GET /api/v1/dispatch/offers/me`
- `GET /api/v1/dispatch/trips/current`
- `GET /api/v1/drivers/me/work-state`
- `PUT /api/v1/drivers/me/work-state`
- `POST /api/v1/dispatch/trips/:tripId/arrive`
- `POST /api/v1/dispatch/trips/:tripId/start`
- `POST /api/v1/dispatch/trips/:tripId/complete`
- `POST /api/v1/payments/trips/:tripId/capture`
- `GET /api/v1/payments/trips/:tripId`
- `GET /api/v1/trips/history`

Mutating commands require an `Idempotency-Key`. Completion requires positive
integer `actualDistanceMeters` and `actualDurationSeconds`; the local API
limits these values to protect the demo boundary.

## Verification evidence

- API typecheck passed.
- Pricing unit tests passed, including surge clamping and exact final-fare
  calculation.
- Dispatch integration tests passed for arrival, start, completion, duplicate
  completion, assignment release, and Driver Work State restoration.
- Payment integration tests passed for duplicate capture, failed retry,
  `UNKNOWN`, `PENDING`, history ownership, and IDOR protection.
- Realtime integration tests passed with completion fields in the rebuildable
  snapshot.
- Web production build passed.

## Known limitations

- Payment is a simulator; no card, provider, or real-money operation exists.
- The Driver PWA uses bounded foreground polling for the console. Background
  location tracking and reconnect backoff are not implemented.
- Payment `UNKNOWN` is surfaced as a reconciliation-required conflict; an
  operator reconciliation command is future work.
