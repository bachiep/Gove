# Danh Mục API và Event Cho Báo Cáo

Trạng thái: Đã đối chiếu với controller và repository hiện tại
Cập nhật lần cuối: 2026-09-25

Tất cả REST endpoint dùng prefix `/api/v1`. Tên endpoint, role, event và message
giữ nguyên tiếng Anh để đối chiếu trực tiếp với source code và OpenAPI.

## Identity và Driver

| Method   | Endpoint                          | Actor         | Purpose                                  |
| -------- | --------------------------------- | ------------- | ---------------------------------------- |
| POST     | `/auth/register`                  | Public        | Register Customer or Driver idempotently |
| POST     | `/auth/login`                     | Public        | Create access token and refresh session  |
| POST     | `/auth/refresh`                   | Session       | Rotate refresh session                   |
| POST     | `/auth/logout`                    | Session       | Revoke session and clear cookie          |
| GET      | `/auth/me`                        | Authenticated | Read current actor                       |
| GET/PUT  | `/drivers/me/profile`             | Driver        | Read or update owned profile             |
| GET/POST | `/drivers/me/vehicles`            | Driver        | List or add owned Vehicles               |
| DELETE   | `/drivers/me/vehicles/:vehicleId` | Driver        | Retire owned Vehicle                     |
| GET      | `/drivers/me/eligibility`         | Driver        | Read matching eligibility                |
| PUT      | `/drivers/me/location`            | Driver        | Publish validated Latest Location        |
| GET/PUT  | `/drivers/me/work-state`          | Driver        | Read or change availability              |

## Ride, Dispatch và Payment

| Method | Endpoint                           | Actor                             | Purpose                                                                  |
| ------ | ---------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/pricing/fare-quotes`             | Customer                          | Create immutable Fare Quote                                              |
| POST   | `/trips`                           | Customer                          | Create Trip from valid quote                                             |
| POST   | `/trips/:tripId/cancel`            | Customer owner                    | Cancel eligible Ride idempotently                                        |
| GET    | `/trips/history`                   | Customer/Driver                   | Read visible terminal history                                            |
| GET    | `/trips/current`                   | Customer                          | Read the current active Trip with pickup/dropoff locations               |
| POST   | `/dispatch/trips/:tripId/match`    | Customer owner                    | Start bounded matching                                                   |
| GET    | `/dispatch/offers/me`              | Driver                            | List pending Trip Offers                                                 |
| GET    | `/dispatch/trips/current`          | Driver                            | Read active Ride assignment                                              |
| POST   | `/dispatch/offers/:offerId/accept` | Offered Driver                    | Commit assignment                                                        |
| POST   | `/dispatch/offers/:offerId/reject` | Offered Driver                    | Reject and attempt reassignment                                          |
| POST   | `/dispatch/trips/:tripId/arrive`   | Assigned Driver                   | Move to `AT_PICKUP`                                                      |
| POST   | `/dispatch/trips/:tripId/start`    | Assigned Driver                   | Move to `IN_PROGRESS`                                                    |
| POST   | `/dispatch/trips/:tripId/complete` | Assigned Driver                   | Finalize Fare and complete Trip                                          |
| POST   | `/payments/trips/:tripId/capture`  | Customer owner                    | Capture through configured `SIMULATOR` or safe pending provider baseline |
| GET    | `/payments/trips/:tripId`          | Customer/assigned Driver/Operator | Read latest Payment Attempt with role-controlled visibility              |

## Delivery

| Method | Endpoint                            | Actor           | Purpose                                       |
| ------ | ----------------------------------- | --------------- | --------------------------------------------- |
| POST   | `/deliveries`                       | Customer        | Create parcel Delivery                        |
| GET    | `/deliveries`                       | Customer        | List owned Delivery history                   |
| GET    | `/deliveries/active`                | Customer        | List owned non-terminal Deliveries for resume |
| GET    | `/deliveries/:deliveryId`           | Customer owner  | Read privacy-safe Delivery                    |
| POST   | `/deliveries/:deliveryId/match`     | Customer owner  | Start Delivery matching                       |
| GET    | `/delivery-offers/me`               | Driver          | List pending Delivery Offers                  |
| GET    | `/delivery-assignments/current`     | Driver          | Read current Delivery assignment              |
| GET    | `/delivery-assignments/:deliveryId` | Assigned Driver | Read owned Delivery projection                |
| POST   | `/delivery-offers/:offerId/accept`  | Offered Driver  | Commit Delivery assignment                    |
| POST   | `/deliveries/:deliveryId/arrive`    | Assigned Driver | Move to `AT_PICKUP`                           |
| POST   | `/deliveries/:deliveryId/pickup`    | Assigned Driver | Confirm custody and move to `IN_TRANSIT`      |
| POST   | `/deliveries/:deliveryId/complete`  | Assigned Driver | Record proof and move to `DELIVERED`          |

## Operations

| Method | Endpoint            | Actor    | Purpose                        |
| ------ | ------------------- | -------- | ------------------------------ |
| GET    | `/health/live`      | Public   | Process liveness               |
| GET    | `/health/ready`     | Public   | Dependency-aware readiness     |
| GET    | `/realtime/metrics` | Operator | Process-local realtime metrics |

## Operator diagnostics và onboarding review

| Method | Endpoint                                                      | Actor    | Purpose                                                                  |
| ------ | ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| GET    | `/operator/trips/:tripId/timeline`                            | Operator | Read a PII-minimized diagnostic timeline                                 |
| POST   | `/operator/trips/:tripId/diagnostic-reviews`                  | Operator | Record a reasoned diagnostic review with optional bounded correlation ID |
| POST   | `/operator/drivers/:driverUserId/approve`                     | Operator | Approve a complete Driver profile with an audit reason                   |
| POST   | `/operator/drivers/:driverUserId/reject`                      | Operator | Reject a Driver profile with an audit reason                             |
| POST   | `/operator/drivers/:driverUserId/vehicles/:vehicleId/approve` | Operator | Approve and select a Driver Vehicle                                      |
| POST   | `/operator/drivers/:driverUserId/vehicles/:vehicleId/reject`  | Operator | Reject a Driver Vehicle                                                  |

Operator mutation endpoints currently rely on transactional audit records and
role authorization; an `Idempotency-Key` contract for these mutations remains
an open hardening item.

## WebSocket protocol

Endpoint: `/ws`.

Client message types: `authenticate`, `subscribe` (with `tripIds` and/or
`deliveryIds`, total maximum 20), `location`, `ping`.

Server message types: `authenticated`, `trip.snapshot`, `trip.event`,
`delivery.snapshot`, `delivery.event`, `driver.location`, `location.accepted`,
`pong`, `error`.

WebSocket truyền projection có thể dựng lại. Sau reconnect, client lấy HTTP
snapshot có thẩm quyền và dùng aggregate version để loại event cũ hoặc trùng.

## Transactional outbox events

### Trip và Dispatch

- `trip.created`
- `trip.matching.started`
- `dispatch.offer.created`
- `dispatch.offer.rejected`
- `dispatch.offer.reassigned`
- `dispatch.offer.expired`
- `trip.driver.assigned`
- `trip.driver.arrived`
- `trip.started`
- `trip.completed`
- `trip.cancelled`
- `trip.no_driver_available`

### Payment

Payment event type được tạo từ simulation outcome:

- `payment.succeeded`
- `payment.failed`
- `payment.pending`
- `payment.unknown`

### Delivery

- `delivery.created`
- `delivery.matching.started`
- `delivery.driver.assigned`
- `delivery.driver.arrived_at_pickup`
- `delivery.pickup.custody_confirmed`
- `delivery.completed`
- `delivery.no_driver_available`

Mỗi event bền vững có event ID, aggregate ID, aggregate version khi áp dụng,
event type, payload version, payload, occurred timestamp và publish metadata.
Không được suy diễn delivery guarantee hoặc DLQ production khi implementation
hiện tại chỉ dùng process-local poller.

`trip.cancelled` hiện được tạo bởi Customer cancellation command. Payload hiện
bao gồm `tripId`, `state`, `version`, `cancelledByRole`, `reasonCode`,
`ruleCode`, và `cancelledAt`; không bao gồm `reasonDetail`. Driver/Operator
cancellation, realtime/browser evidence, và race evidence cho event này vẫn
đang chờ.
