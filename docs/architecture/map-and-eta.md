# Map, Live Location, and ETA

## Status

| Capability                                       | Status              | Evidence / limitation                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive map canvas in Customer request flows | Implemented locally | Staged MapLibre renderer when configured and supported, with Leaflet fallback, pickup/dropoff markers, zoom controls, attribution, and responsive fallback                                               |
| Backend routing provider seam                    | Implemented locally | `apps/api/src/routing/**` provides adapter selection, provenance metadata, bounded timeout, and deterministic coordinate fallback                                                                        |
| Road-aware route geometry                        | Partial locally     | `FareQuoteResponse.route` now carries validated geometry/provenance; an opt-in private OSRM Compose profile is configured, but no prepared dataset or runtime/browser success evidence is retained yet   |
| Driver GPS sender from the PWA                   | Implemented locally | Driver Console requests foreground `navigator.geolocation`, sends a bounded GPS update no more often than the API's 3-second limit, and shows permission/error state; background tracking is not claimed |
| Customer live Driver marker                      | Implemented locally | Trip and Delivery PWA surfaces render an authorized fresh `driverLocation`; browser Driver custody acceptance remains under verification                                                                 |
| Road-based ETA                                   | Planned             | Current quote duration is not a live navigation ETA; Driver Console currently shows coordinates and a fallback preview until a road provider is verified                                                 |

## Why this belongs in the MVP

Map is a core product surface for both ride-hailing and delivery:

- Customer can confirm pickup and dropoff visually.
- Customer can understand whether the Driver is approaching or moving toward the destination.
- Driver can see the next operational target: pickup first, then dropoff.
- Operations and QA can inspect stale location, reconnect, and ETA behavior with visible evidence.

The map is a projection. It must never become the source of truth for Trip,
Delivery, Driver Work State, assignment, payment, or custody state.

## Current architecture evidence

- `Trip` and `Delivery` own pickup/dropoff coordinates.
- PostGIS owns the durable Latest Driver Location projection.
- `PUT /api/v1/drivers/me/location` validates coordinates, accuracy, freshness,
  capture time, and monotonic sequence.
- Dispatch uses PostGIS distance queries for candidate generation and ranking.
- The authenticated WebSocket gateway delivers Trip snapshots and validated
  `driver.location` updates.
- The Customer PWA now has a staged MapLibre GL JS renderer for coordinate
  preview. It is enabled only when `VITE_MAPLIBRE_STYLE_URL` is configured,
  WebGL is available, and the style loads successfully; otherwise the UI uses
  the Leaflet fallback.
- If a tile provider is unavailable, the UI retains the coordinates and route
  preview instead of blocking request creation.
- The Driver Console receives pickup/dropoff coordinates for the active Trip or
  Delivery, renders the same map fallback, and sends foreground GPS only while
  an active assignment is visible. The browser must remain open and location
  permission must be granted; this is not background mobile tracking.
- Fare Quote responses carry optional routing geometry and provenance. The UI
  renders a solid suggested route only for a non-fallback provider result; a
  fallback or legacy receipt remains a dashed `Tuyến ước tính theo tọa độ`.

## Target data flow

```text
Driver GPS
    ↓
Location API / WebSocket command
    ↓
PostgreSQL + PostGIS — Latest Location source of truth
    ↓
Realtime Gateway — authenticated projection
    ↓
Customer / Driver map
```

```text
Pickup + Dropoff + current Driver location
    ↓
RoutingProvider
    ↓
Road geometry + distance + duration + metadata.updatedAt
    ↓
Map polyline + ETA projection
```

## Milestones

### M1 — Real map visualization

- Render map tiles through a replaceable map adapter.
- Show pickup and dropoff markers.
- Show a coordinate preview line while road routing is not available.
- Keep manual coordinate entry and a map-independent fallback.
- Verify at 375px, 768px, 1024px, and 1440px.

### M2 — Live Driver tracking

- Use `navigator.geolocation.watchPosition` in the foreground Driver PWA.
- Send location at a bounded interval, with sequence and capture metadata.
- Render `driver.location` on the Customer map after assignment.
- Show `Live`, `Stale`, `Đang kết nối lại`, and last-updated time.
- Apply the same authorization and freshness rules to Delivery subscriptions.

### M3 — Road routing and ETA

- The `RoutingProvider` interface behind the backend boundary is implemented
  locally as a backend seam; a real road provider is still not configured.
- Return road distance, duration, geometry, provider/version, and
  `metadata.updatedAt`.
- Driver sees the recommended route to pickup and then dropoff.
- Customer sees ETA to pickup and ETA to destination.
- Recalculate only on meaningful location/time thresholds to control cost and
  avoid route jitter.

## Provider decision

For the academic/local MVP, MapLibre GL JS is the staged primary browser
renderer and Leaflet is the compatibility fallback. MapLibre does not provide
a basemap by itself: the style URL and its sources remain deployment
configuration. The route provider remains an adapter so the project can use a
local OSRM instance, a managed provider, or a self-hosted service without
coupling business logic to one vendor.

The public OpenStreetMap tile service is suitable only when its tile usage
policy is respected. It must not be treated as an unlimited production tile
backend. Production/staging deployment requires an explicitly selected tile
provider, attribution, caching policy, rate limits, and a documented fallback.

Sources:

- [MapLibre GL JS project](https://maplibre.org/projects/gl-js/)
- [Leaflet reference](https://leafletjs.com/reference)
- [OSRM API documentation](https://project-osrm.org/docs/)
- [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)

## Implemented backend routing seam

The local backend now has a small routing module with a stable `RoutingService`
interface in
`apps/api/src/routing/**`. A caller provides an `origin`, `destination`, and
the currently supported `DRIVING` profile. The service returns:

- `distanceMeters`, `durationSeconds`, and a GeoJSON-compatible `LineString`;
- `metadata.provider`, `metadata.version`, and ISO `metadata.updatedAt`;
- `usedFallback` and `fallbackReason` so a coordinate estimate cannot be
  mistaken for a provider-backed road route.

The seam accepts an optional `RoutingProvider` adapter. When
`ROUTING_OSRM_BASE_URL` is configured, the bounded OSRM adapter is selected;
otherwise the deterministic coordinate fallback is used. The primary adapter
is bounded by a default 750 ms timeout and a hard configuration maximum of
3,000 ms. Provider errors and timeouts are converted into the deterministic
`CoordinateFallbackRoutingProvider`, which calculates a Haversine coordinate
distance and a fixed-speed estimate (`coordinate-fallback-v1`). The fallback
is intentionally a coordinate preview: it does not claim road geometry,
shortest-route behavior, traffic awareness, or production capacity.

Focused tests in
`apps/api/src/routing/routing.service.spec.ts` cover deterministic output,
provider metadata, provider errors, timeout/abort behavior, and invalid input.

The optional runtime seam is documented in
[OSRM staging](../operations/osrm-staging.md). Both Compose files keep the
OSRM service behind the `osrm` profile and mount only an operator-created,
read-only external data volume. Staging uses the private `http://osrm:5000/`
service address and publishes no OSRM host port. The default profile remains
unset so an environment without a prepared dataset truthfully uses coordinate
fallback.

## ETA rules

The UI must distinguish:

- `Distance to pickup` from `Distance to destination`.
- `ETA to pickup` from `ETA to destination`.
- `Live` from `Stale` location.
- A routing-provider estimate from a measured actual duration.

The system must not call a provider result the “shortest route” unless the
selected routing profile and evidence support that claim. The user-facing
label is `Tuyến đề xuất`.

## Acceptance criteria

- Customer request pages render a map or a truthful fallback without blocking
  the form.
- Pickup and dropoff coordinates are visible and labeled.
- A Driver marker is shown only after an authorized assignment and an accepted
  fresh location.
- A stale or disconnected Driver location is visibly marked and never silently
  presented as current.
- Reconnect restores the authoritative REST/WebSocket snapshot before applying
  newer events.
- Driver route changes from pickup to dropoff only after the corresponding
  domain transition is committed.
- ETA updates are timestamped, bounded, and never presented as a verified
  measurement before the route provider and browser flow are tested.
- Browser Harness evidence covers mobile layout, keyboard access, reconnect,
  tile/provider failure, and console/network errors.

## Known limitations

- The current UI map displays coordinates and a preview line. The staged
  MapLibre local renderer has browser evidence with the checked-in preview
  style, but the preview line does not provide road-aware route geometry.
- The backend routing seam, optional OSRM adapter, and Fare Quote route
  projection are implemented, but no OSRM runtime/browser evidence is retained
  yet. Its coordinate fallback must remain labeled as an estimate.
- The 2026-09-25 Browser Harness run could not reach the public OSM tile host
  (`ERR_CONNECTION_REFUSED`), so provider-failure fallback remains the only
  browser-verified map path. This is not evidence that a selected staging tile
  provider is healthy.
- Driver foreground GPS sender is implemented and API-covered, but a full
  browser Driver custody run, real device permission flow, road route guidance,
  and Delivery live location evidence remain under verification.
- Current fare/duration estimation remains a domain estimate and must not be
  reused as live road ETA.
