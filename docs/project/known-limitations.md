# Known Limitations

Status: Active
Last updated: 2026-09-25

These are observed boundaries of the current implementation or its evidence.
They are not hidden production claims. A limitation that violates the frozen
completion definition remains blocking; an explicit non-goal does not.

## Blocking completion gaps

- Browser evidence covers public/auth pages and selected Customer flows, but
  authenticated Driver/Operator custody, reconnect, and full accessibility
  gates are not closed.
- The load evidence now includes a bounded closed-loop no-approved-Driver smoke
  run, but it does not yet measure accepted matching, GPS, WebSocket,
  contention, resource utilization, or business capacity.
- Mandatory repeated race evidence, including Trip-versus-Delivery contention,
  is incomplete.
- Security review is partially closed locally; stale realtime location,
  production simulator input, authentication revalidation command racing, and
  foreground location consent are covered locally. Proxy-aware and
  multi-instance controls, diagnostics exposure policy, and application
  rollback rehearsal remain incomplete.
- Operator diagnostic/audit browser acceptance evidence required by FR-18 is
  incomplete.

## Accepted MVP boundaries

- `SIMULATOR` supports deterministic payment tests and does not move real
  money or store card data. `MOMO` and `SEPAY` are provider baselines that
  only create `PENDING` attempts; QR, provider API calls, webhook
  verification, reconciliation, and real-money evidence are not implemented.
- When OSRM is not configured or unavailable, routing uses a deterministic
  coordinate fallback; it is not a road network or traffic-aware ETA.
- The Customer request UI has a staged MapLibre renderer when
  `VITE_MAPLIBRE_STYLE_URL` and WebGL are available, with a Leaflet fallback
  when style loading or WebGL is unavailable. Fare Quotes expose optional
  routing geometry/provenance, while the coordinate fallback remains a preview
  line. MapLibre success, OSRM runtime evidence, Delivery live-marker browser
  evidence, Driver route guidance, and road-based ETA remain under verification
  or planned.
- Public map tiles are an external dependency. The local Browser Harness could
  not reach the public OSM tile host, so the UI keeps a truthful coordinate
  fallback. A staging/production tile provider and usage policy must be chosen
  before claiming reliable map availability.
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
