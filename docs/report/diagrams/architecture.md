# Sơ Đồ Kiến Trúc

Trạng thái: Implementation hiện tại nếu không có ghi chú khác
Cập nhật lần cuối: 2026-09-25

## D-01 — Bối cảnh hệ thống

```mermaid
flowchart LR
    customer[Customer]
    driver[Driver]
    operator[Operator]
    gove[Gove Platform]
    gps[Device Location Sensor]

    customer -->|Requests rides and deliveries| gove
    driver -->|Provides location and service| gove
    operator -->|Inspects health and diagnostics| gove
    gps -->|Foreground coordinates| gove
    gove -->|Status, history, simulated settlement| customer
    gove -->|Offers, assignments, earnings data| driver
```

Phạm vi hiện tại không bắt buộc map, routing, notification hoặc payment
provider trả phí. Payment được mô phỏng và tọa độ có thể nhập thủ công.

## D-02 — Kiến trúc runtime

```mermaid
flowchart LR
    subgraph clients[Client]
        pwa[React PWA]
    end

    subgraph ingress[Ingress]
        vite[Vite Dev Proxy]
        nginx[Nginx Staging Proxy]
    end

    subgraph application[NestJS Modular Monolith]
        http[REST API]
        websocket[WebSocket Gateway]
        workers[Expiry and Outbox Pollers]
        modules[Business Modules]
    end

    subgraph storage[Durable Storage]
        postgres[(PostgreSQL 17 with PostGIS)]
    end

    pwa -->|Local HTTP and WS| vite
    pwa -->|Staging HTTP and WS| nginx
    vite --> http
    vite --> websocket
    nginx --> http
    nginx --> websocket
    http --> modules
    websocket --> modules
    workers --> modules
    modules --> postgres
```

Vite và Nginx là hai lựa chọn theo môi trường. PostgreSQL/PostGIS có thẩm quyền;
Redis và message broker chưa thuộc runtime hiện tại.

## D-03 — Quyền sở hữu module

```mermaid
flowchart TB
    identity[Identity]
    driver[Driver]
    location[Location]
    pricing[Pricing]
    trip[Trip]
    dispatch[Dispatch]
    payment[Payment]
    delivery[Delivery]
    operator[Operator Diagnostics and Audit]
    realtime[Realtime]
    database[(Owned PostgreSQL Schemas)]

    identity -->|Actor and roles| driver
    identity -->|Actor and roles| trip
    identity -->|Actor and roles| delivery
    driver -->|Eligibility| dispatch
    location -->|Fresh candidates| dispatch
    pricing -->|Immutable quote| trip
    trip -->|Demand and lifecycle| dispatch
    dispatch -->|Assignment commands| trip
    trip -->|Final Fare| payment
    delivery -->|Shared work-state coordination| dispatch
    operator -->|Audited diagnostics and onboarding review| trip
    operator -->|Audited approval actions| driver
    trip -->|Snapshots and outbox| realtime
    location -->|Latest Location| realtime

    identity --> database
    driver --> database
    location --> database
    pricing --> database
    trip --> database
    dispatch --> database
    payment --> database
    delivery --> database
```

Các cạnh mô tả interface hoặc phối hợp transaction, không cấp quyền cập nhật
trực tiếp bảng thuộc module khác.

## D-04 — Triển khai local và staging

```mermaid
flowchart TB
    subgraph local[Local Development]
        localBrowser[Browser]
        vite[Vite 5173]
        localApi[NestJS 3000]
        localDb[(PostgreSQL 55432)]
        localBrowser --> vite
        vite -->|Proxy API and WS| localApi
        localApi --> localDb
    end

    subgraph staging[Demo Staging Compose]
        stageBrowser[Browser]
        tls[External TLS Reverse Proxy]
        nginx[Nginx PWA Container]
        api[Private API Container]
        migrate[One-shot Migration Job]
        db[(Private PostgreSQL)]
        stageBrowser -->|HTTPS and WSS| tls
        tls --> nginx
        nginx -->|API and WS proxy| api
        migrate --> db
        api --> db
    end
```

Stack staging đã được kiểm thử local. TLS reverse proxy bên ngoài và VPS định
danh vẫn là bằng chứng deployment có điều kiện.

## D-05 — Trust boundary bảo mật

```mermaid
flowchart LR
    browser[Untrusted Browser]
    ingress[Trusted Ingress]
    auth[Authentication Boundary]
    business[Authorized Business Commands]
    database[(Private Database)]
    secrets[Host-managed Secrets]

    browser -->|Cookie and bearer token| ingress
    ingress -->|Origin and rate checks| auth
    auth -->|Actor ID and roles| business
    business -->|Parameterized transactions| database
    secrets -->|Runtime injection| auth
    secrets -->|Database credential| database
```

Trình duyệt kiểm soát payload nhưng không kiểm soát actor ID, Fare, ownership
của assignment hoặc quyền chuyển trạng thái. Refresh token nằm trong HttpOnly
cookie; access token chỉ được giữ trong bộ nhớ PWA.
