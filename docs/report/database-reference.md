# Tham Chiếu Cơ Sở Dữ Liệu Cho Báo Cáo

Trạng thái: Đã đối chiếu với migration hiện tại
Cập nhật lần cuối: 2026-09-24

## Nền tảng dữ liệu

Gove dùng PostgreSQL 17 và PostGIS. PostgreSQL là nguồn sự thật bền vững cho
identity, Driver, Latest Location, Fare Quote, Trip, Dispatch, Payment và
Delivery. PostGIS cung cấp kiểu `geography(Point, 4326)` và GiST index cho truy
vấn Driver gần Pickup.

## Danh mục migration

| Migration                               | Nội dung chính                                                 |
| --------------------------------------- | -------------------------------------------------------------- |
| `0001-foundation.sql`                   | PostGIS và các schema ban đầu                                  |
| `0002-identity-auth.sql`                | User, role, credential, refresh session, receipt               |
| `0003-driver-profile-and-vehicle.sql`   | Driver profile, Vehicle và index eligibility                   |
| `0004-pricing-and-trip-write-model.sql` | Service Type, rate card, Fare Quote, Trip, transition, outbox  |
| `0005-dispatch-foundation.sql`          | Latest Location, work state, reservation và Trip Offer         |
| `0006-completion-and-payment.sql`       | Ride assignment, final Fare và Payment Attempt                 |
| `0007-delivery-foundation.sql`          | Delivery aggregate, transition, receipt và outbox              |
| `0008-delivery-dispatch.sql`            | Delivery reservation/offer/assignment và work state dùng chung |
| `0009-delivery-custody-and-proof.sql`   | Custody confirmation và Delivery Proof                         |

Migration runner tạo `public.schema_migrations`, dùng advisory lock để chỉ có
một tiến trình migration tại một thời điểm, và áp dụng mỗi file trong một
transaction.

## Invariant quan trọng cần giải thích

### Một Driver chỉ phục vụ một công việc

`dispatch.driver_work_states` chỉ cho phép một trong `current_trip_id` hoặc
`current_delivery_id` có giá trị khi Driver ở trạng thái bận. Partial unique
index và active reservation/assignment index bổ sung lớp bảo vệ tại database.

### Idempotency bền vững

Các bảng `command_receipts` lưu actor, operation, idempotency key, fingerprint
của request và response bền vững. Cùng key và cùng payload trả kết quả trước;
cùng key nhưng payload khác bị từ chối.

### Aggregate version và lịch sử

Trip và Delivery có `version`. Mỗi transition ghi `from_version`, `to_version`,
actor, command, correlation ID và thời điểm. Unique constraint trên aggregate
và `to_version` ngăn hai transition cùng chiếm một version.

### Transactional outbox

State change và outbox event được commit cùng transaction. Realtime poll các
event đã commit, vì vậy WebSocket không trở thành nguồn sự thật nghiệp vụ.

### Fare không do client quyết định

Fare Quote lưu rate-card/rule snapshot. Final Fare sử dụng snapshot đã chấp
nhận và observed metering; Payment lấy amount từ Trip đã hoàn thành thay vì từ
payload của client.

### Custody và proof

Delivery chỉ chuyển sang `IN_TRANSIT` khi có custody confirmation hợp lệ và chỉ
chuyển sang `DELIVERED` khi có proof giới hạn 1–120 ký tự. Proof media chưa nằm
trong phạm vi.

## Index đáng trình bày

- GiST index trên Latest Location phục vụ nearby query.
- Freshness index hỗ trợ loại vị trí stale.
- Partial unique index cho active reservation, pending Offer và active
  assignment.
- Worklist index cho Offer hết hạn và outbox chưa publish.
- History index theo Customer/Driver và thời gian tạo.

## Cách đưa SQL vào báo cáo

Không nên chép toàn bộ migration vào thân bài. Chọn một đoạn DDL minh họa cho
mỗi chủ đề: geography index, partial unique index, work-state check constraint,
idempotency receipt, transition version hoặc outbox. Đưa danh sách migration và
verification queries vào phụ lục; dẫn chính xác filename và constraint/index
trong phần phân tích.
