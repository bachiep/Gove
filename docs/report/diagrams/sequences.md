# Sơ Đồ Tuần Tự

Trạng thái: Implementation hiện tại nếu không có ghi chú khác
Cập nhật lần cuối: 2026-09-24

## D-10 — Đăng nhập và xoay vòng refresh session

```mermaid
sequenceDiagram
    title Login and rotating refresh session
    participant User
    participant PWA
    participant IdentityAPI
    participant PostgreSQL

    User->>PWA: Submit credentials
    PWA->>IdentityAPI: POST /auth/login
    IdentityAPI->>PostgreSQL: Read user and credential
    PostgreSQL-->>IdentityAPI: Identity records
    IdentityAPI->>PostgreSQL: Create refresh session
    PostgreSQL-->>IdentityAPI: Session committed
    IdentityAPI-->>PWA: Access token and HttpOnly cookie
    PWA->>IdentityAPI: POST /auth/refresh
    IdentityAPI->>PostgreSQL: Lock and rotate session
    PostgreSQL-->>IdentityAPI: New session generation
    IdentityAPI-->>PWA: New token and cookie
```

## D-11 — Luồng Ride thành công

```mermaid
sequenceDiagram
    title Ride from quote to completion
    participant CustomerPWA
    participant API
    participant PostgreSQL
    participant DriverPWA
    participant WebSocket

    CustomerPWA->>API: POST /pricing/fare-quotes
    API-->>CustomerPWA: Immutable Fare Quote
    CustomerPWA->>API: POST /trips
    API->>PostgreSQL: Create Trip and outbox event
    CustomerPWA->>API: POST /dispatch/trips/id/match
    API->>PostgreSQL: Reserve Driver and create Offer
    DriverPWA->>API: POST /dispatch/offers/id/accept
    API->>PostgreSQL: Commit assignment and transition
    PostgreSQL-->>WebSocket: Poll committed outbox
    WebSocket-->>CustomerPWA: Trip event
    DriverPWA->>API: Arrive, start, complete
    API->>PostgreSQL: Final Fare and release Driver
    API-->>DriverPWA: Completed Trip detail
    WebSocket-->>CustomerPWA: Completed projection
```

Payment capture được tách thành D-14 vì settlement có idempotency và failure
lifecycle riêng.

## D-12 — Luồng Delivery thành công

```mermaid
sequenceDiagram
    title Parcel Delivery custody lifecycle
    participant CustomerClient
    participant DeliveryAPI
    participant PostgreSQL
    participant DriverConsole

    CustomerClient->>DeliveryAPI: POST /deliveries
    DeliveryAPI->>PostgreSQL: Create Delivery and receipt
    CustomerClient->>DeliveryAPI: POST /deliveries/id/match
    DeliveryAPI->>PostgreSQL: Reserve Driver and create Offer
    DriverConsole->>DeliveryAPI: POST /delivery-offers/id/accept
    DeliveryAPI->>PostgreSQL: Commit assignment
    DriverConsole->>DeliveryAPI: POST /deliveries/id/arrive
    DeliveryAPI->>PostgreSQL: Transition to AT_PICKUP
    DriverConsole->>DeliveryAPI: POST /deliveries/id/pickup
    DeliveryAPI->>PostgreSQL: Record custody confirmation
    DriverConsole->>DeliveryAPI: POST /deliveries/id/complete
    DeliveryAPI->>PostgreSQL: Record proof and release Driver
    DeliveryAPI-->>CustomerClient: Authoritative DELIVERED status
```

Backend và Driver Console đã có. UI tạo Delivery và WebSocket projection cho
Customer còn thiếu; trạng thái cuối hiện có thể đọc qua HTTP/history.

## D-13 — Tranh chấp Driver giữa Trip và Delivery

```mermaid
sequenceDiagram
    title One Driver cannot serve competing work
    participant TripRequest
    participant DeliveryRequest
    participant GoveAPI
    participant PostgreSQL

    TripRequest->>GoveAPI: Match Trip
    DeliveryRequest->>GoveAPI: Match Delivery
    GoveAPI->>PostgreSQL: Transaction A locks Driver work state
    GoveAPI->>PostgreSQL: Transaction B waits for same row
    PostgreSQL-->>GoveAPI: Transaction A reserves Driver
    GoveAPI->>PostgreSQL: Transaction A commits
    PostgreSQL-->>GoveAPI: Transaction B rechecks unavailable Driver
    GoveAPI->>PostgreSQL: Select another Driver or no-driver
    GoveAPI-->>TripRequest: Persisted result
    GoveAPI-->>DeliveryRequest: Non-conflicting persisted result
```

Shared work-state constraint và transaction đã được triển khai. Stress gate
lặp lại trên hai domain vẫn còn Pending trong acceptance matrix.

## D-14 — Payment mô phỏng có idempotency

```mermaid
sequenceDiagram
    title Payment capture retry
    participant CustomerPWA
    participant PaymentAPI
    participant PostgreSQL

    CustomerPWA->>PaymentAPI: POST capture with key K
    PaymentAPI->>PostgreSQL: Lock Trip and read final Fare
    PaymentAPI->>PostgreSQL: Insert Attempt, receipt, outbox
    PostgreSQL-->>PaymentAPI: Committed outcome
    PaymentAPI-->>CustomerPWA: Payment Attempt
    CustomerPWA->>PaymentAPI: Retry capture with key K
    PaymentAPI->>PostgreSQL: Read matching receipt
    PostgreSQL-->>PaymentAPI: Original outcome
    PaymentAPI-->>CustomerPWA: Same Payment Attempt
```

## D-15 — Phục hồi sau reconnect realtime

```mermaid
sequenceDiagram
    title Rebuild state after WebSocket reconnect
    participant PWA
    participant HTTPAPI
    participant WebSocket
    participant PostgreSQL

    PWA->>HTTPAPI: GET authoritative Trip snapshot
    HTTPAPI->>PostgreSQL: Read Trip projection
    PostgreSQL-->>HTTPAPI: State and aggregate version
    HTTPAPI-->>PWA: Snapshot version N
    PWA->>WebSocket: Authenticate access token
    WebSocket-->>PWA: Authenticated
    PWA->>WebSocket: Subscribe Trip ID
    WebSocket->>PostgreSQL: Authorize and read snapshot
    PostgreSQL-->>WebSocket: Current version
    WebSocket-->>PWA: Snapshot or newer events
```

Client dùng aggregate version làm ordering guard và loại projection cũ hoặc
trùng lặp.
