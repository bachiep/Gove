# Known Limitations

Status: Active
Last updated: 2026-09-24

These are observed boundaries of the current implementation or its evidence.
They are not hidden production claims. A limitation that violates the frozen
completion definition remains blocking; an explicit non-goal does not.

## Blocking completion gaps

- Customer Delivery creation/detail UI and Delivery realtime are not complete.
- Browser E2E and accessibility evidence is not retained yet.
- The load report measures only liveness on loopback, not GPS, matching,
  WebSocket, or closed-loop business capacity.
- Mandatory repeated race evidence, including Trip-versus-Delivery contention,
  is incomplete.
- Security review and application rollback rehearsal are incomplete.
- Operator diagnostic/audit acceptance required by FR-18 lacks final evidence.

## Accepted MVP boundaries

- Payment is a simulator and does not move real money or store card data.
- Distance uses deterministic straight-line calculation, not a road network or
  traffic-aware ETA.
- Driver location is foreground PWA telemetry; reliable background tracking is
  not claimed.
- Latest Location is retained; historical GPS routes are not stored.
- WebSocket routing and authentication rate limits are process-local.
- PostgreSQL/PostGIS is authoritative; Redis is not required by the current
  single-process slice.
- Delivery supports one parcel, one Pickup, one Dropoff, bounded text custody
  and proof, and no payment, cancellation, reassignment, or proof media.

## Environment boundary

Compose deployment, backup, and restore have been tested locally. No named VPS,
public DNS, TLS/WSS endpoint, firewall posture, or external rollback has been
verified. Until those exist, the strongest truthful environment claim is
`Verified locally`, not `Deployed` or `Production-ready`.

## Review rule

Update this page whenever implementation closes a limitation, introduces a new
one, or changes the accepted scope. Closed limitations move into named evidence
in the acceptance matrix; they are not silently deleted.
