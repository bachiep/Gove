# Sơ Đồ Mô Hình Dữ Liệu

Trạng thái: Phản ánh migration 0002–0009
Cập nhật lần cuối: 2026-09-24

ERD chỉ hiển thị các cột quan trọng để hình còn đọc được. SQL migration là
nguồn sự thật cho toàn bộ cột, constraint và index.

## D-16 — Identity và Driver

```mermaid
erDiagram
    USERS ||--|| CREDENTIALS : has
    USERS ||--o{ USER_ROLES : receives
    ROLES ||--o{ USER_ROLES : grants
    USERS ||--o{ REFRESH_SESSIONS : opens
    USERS ||--o| DRIVER_PROFILES : becomes
    DRIVER_PROFILES ||--o{ VEHICLES : owns
    DRIVER_PROFILES ||--o| LATEST_LOCATIONS : publishes
    DRIVER_PROFILES ||--o| DRIVER_WORK_STATES : has

    USERS {
        uuid id PK
        text normalized_email UK
        text display_name
        text status
        int authentication_epoch
    }
    CREDENTIALS {
        uuid user_id PK, FK
        text password_hash
    }
    ROLES {
        text code PK
    }
    USER_ROLES {
        uuid user_id PK, FK
        text role_code PK, FK
        datetime granted_at
    }
    REFRESH_SESSIONS {
        uuid id PK
        uuid user_id FK
        uuid family_id
        text token_digest UK
        datetime expires_at
        datetime revoked_at
    }
    DRIVER_PROFILES {
        uuid user_id PK, FK
        text review_status
        text phone_number
    }
    VEHICLES {
        uuid id PK
        uuid driver_user_id FK
        text service_type
        text review_status
        bool is_selected
    }
    LATEST_LOCATIONS {
        uuid driver_user_id PK, FK
        geography location
        decimal accuracy_meters
        datetime captured_at
        bigint sequence_number
    }
    DRIVER_WORK_STATES {
        uuid driver_user_id PK, FK
        text work_state
        uuid current_trip_id FK
        uuid current_delivery_id FK
        bigint state_version
    }
```

## D-17 — Pricing, Trip, Dispatch và Payment

```mermaid
erDiagram
    SERVICE_TYPES ||--o{ RATE_CARDS : prices
    SERVICE_TYPES ||--o{ FARE_QUOTES : applies_to
    RATE_CARDS ||--o{ FARE_QUOTES : snapshots
    FARE_QUOTES ||--o| TRIPS : creates
    TRIPS ||--o{ TRIP_TRANSITIONS : records
    TRIPS ||--o{ TRIP_OUTBOX : emits
    TRIPS ||--o{ TRIP_RESERVATIONS : reserves
    TRIP_RESERVATIONS ||--|| TRIP_OFFERS : creates
    TRIPS ||--o| RIDE_ASSIGNMENTS : receives
    TRIP_OFFERS ||--o| RIDE_ASSIGNMENTS : accepts_into
    TRIPS ||--o{ PAYMENT_ATTEMPTS : settles_with

    SERVICE_TYPES {
        text code PK
        text display_name
        bool is_active
    }
    RATE_CARDS {
        uuid id PK
        text service_type_code FK
        int version
        bigint base_fare_minor
        int maximum_surge_bps
    }
    FARE_QUOTES {
        uuid id PK
        uuid customer_user_id FK
        uuid rate_card_version_id FK
        bigint total_fare_minor
        json rule_snapshot
        text status
        datetime expires_at
    }
    TRIPS {
        uuid id PK
        uuid customer_user_id FK
        uuid fare_quote_id FK, UK
        text state
        int version
        bigint final_fare_minor
        datetime completed_at
    }
    TRIP_TRANSITIONS {
        uuid id PK
        uuid trip_id FK
        text command
        text from_state
        text to_state
        int to_version
        text correlation_id
    }
    TRIP_OUTBOX {
        uuid id PK
        uuid trip_id FK
        int aggregate_version
        text event_type
        datetime published_at
    }
    TRIP_RESERVATIONS {
        uuid id PK
        uuid trip_id FK
        uuid driver_user_id FK
        text status
        datetime expires_at
    }
    TRIP_OFFERS {
        uuid id PK
        uuid reservation_id FK, UK
        uuid trip_id FK
        uuid driver_user_id FK
        text status
        datetime expires_at
    }
    RIDE_ASSIGNMENTS {
        uuid id PK
        uuid trip_id FK, UK
        uuid offer_id FK, UK
        uuid driver_user_id FK
        text status
    }
    PAYMENT_ATTEMPTS {
        uuid id PK
        uuid trip_id FK
        uuid customer_user_id FK
        int attempt_number
        bigint amount_minor
        text status
    }
```

## D-18 — Delivery, custody và proof

```mermaid
erDiagram
    DELIVERIES ||--o{ DELIVERY_TRANSITIONS : records
    DELIVERIES ||--o{ DELIVERY_OUTBOX : emits
    DELIVERIES o|--o{ DELIVERY_RECEIPTS : references
    DELIVERIES ||--o{ DELIVERY_RESERVATIONS : reserves
    DELIVERY_RESERVATIONS ||--|| DELIVERY_OFFERS : creates
    DELIVERIES ||--o| DELIVERY_ASSIGNMENTS : receives
    DELIVERY_OFFERS ||--o| DELIVERY_ASSIGNMENTS : accepts_into
    DELIVERY_ASSIGNMENTS ||--o| DELIVERY_PROOFS : produces
    DELIVERIES ||--o| DELIVERY_PROOFS : completes_with

    DELIVERIES {
        uuid id PK
        uuid customer_user_id FK
        geography pickup_location
        geography dropoff_location
        text recipient_display_name
        text recipient_contact_phone
        text parcel_description
        int declared_weight_grams
        text state
        int version
    }
    DELIVERY_TRANSITIONS {
        uuid id PK
        uuid delivery_id FK
        text command
        text from_state
        text to_state
        int to_version
        text correlation_id
    }
    DELIVERY_OUTBOX {
        uuid id PK
        uuid delivery_id FK
        int aggregate_version
        text event_type
        datetime published_at
    }
    DELIVERY_RECEIPTS {
        uuid actor_user_id PK, FK
        text operation PK
        text idempotency_key PK
        uuid delivery_id FK
        bytes request_fingerprint
    }
    DELIVERY_RESERVATIONS {
        uuid id PK
        uuid delivery_id FK
        uuid driver_user_id FK
        text status
        datetime expires_at
    }
    DELIVERY_OFFERS {
        uuid id PK
        uuid delivery_id FK
        uuid reservation_id FK, UK
        uuid driver_user_id FK
        text status
    }
    DELIVERY_ASSIGNMENTS {
        uuid id PK
        uuid delivery_id FK
        uuid offer_id FK, UK
        uuid driver_user_id FK
        text status
        text pickup_custody_confirmation
    }
    DELIVERY_PROOFS {
        uuid id PK
        uuid delivery_id FK, UK
        uuid assignment_id FK, UK
        uuid recorded_by_user_id FK
        text confirmation_text
    }
```

Quan hệ giữa Identity/Driver với các ERD còn lại được lược bớt để tránh hình quá
dày. Các cột `customer_user_id`, `driver_user_id`, `actor_user_id` và
`recorded_by_user_id` đều tham chiếu về bảng owner tương ứng.
