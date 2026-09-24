# Khung Báo Cáo Đề Xuất

Trạng thái: Đã thiết kế
Cập nhật lần cuối: 2026-09-24

Bố cục dưới đây ánh xạ các chương thường có trong báo cáo học thuật với nguồn
tài liệu tương ứng trong repository.

## Chương 1 — Giới thiệu và phát biểu bài toán

Trình bày động lực, stakeholder, phạm vi bài toán, mục tiêu, ràng buộc và những
nội dung chủ động loại khỏi phạm vi.

Nguồn chính: project charter, completion definition, yêu cầu MVP, yêu cầu M7 và
known limitations.

Hình đề xuất: system context và tổng quan actor/use case.

## Chương 2 — Phân tích yêu cầu và domain

Phân tích Customer, Driver, Operator, Ride, Delivery, Location, Dispatch,
Pricing, Payment, yêu cầu chức năng, phi chức năng, invariant và kịch bản
nghiệm thu.

Nguồn chính: `CONTEXT.md`, `docs/requirements`, `docs/domain` và acceptance
matrix.

Hình đề xuất: use case Ride, use case Delivery, state machine Trip và Delivery.

## Chương 3 — Kiến trúc và quyết định thiết kế

Giải thích modular monolith, lý do PostgreSQL/PostGIS là nguồn dữ liệu có thẩm
quyền, boundary module, giao tiếp, consistency, failure model và điều kiện tách
service.

Nguồn chính: `docs/architecture`, `docs/adr` và technical debt register.

Hình đề xuất: runtime architecture, module ownership, deployment topology và
trust boundary.

## Chương 4 — Thiết kế dữ liệu và API

Giải thích schema, ownership, khóa, index, dữ liệu không gian, idempotency
receipt, aggregate version, transition history, outbox, API contract, error
model và giao thức WebSocket.

Nguồn chính: SQL migration, `docs/data`, `docs/api` và database reference.

Hình đề xuất: ba ERD theo bounded context, sequence xác thực và reconnect.

## Chương 5 — Cài đặt các luồng nghiệp vụ cốt lõi

Mô tả một vertical slice Ride và một Delivery từ lệnh UI qua transaction tới
projection. Giải thích reservation, offer expiry, idempotency, final Fare,
Payment mô phỏng, custody và proof.

Nguồn chính: implementation docs, source API/web và shared contracts.

Hình đề xuất: sequence Ride, Delivery, Payment và tranh chấp Driver.

## Chương 6 — Kiểm thử và đánh giá

Trình bày riêng unit, integration, contract, E2E, concurrency, security,
resilience và performance. Chỉ ghi kết quả đã quan sát, kèm môi trường, dataset,
thời lượng, phiên bản và giới hạn.

Nguồn chính: testing strategy, acceptance matrix, performance report và bằng
chứng test/browser từ demo runbook.

## Chương 7 — Triển khai và vận hành

Trình bày local development, staging Compose, migration, health check, reverse
proxy/TLS, backup, restore, rollback, logging, metrics và trạng thái môi trường.

Nguồn chính: Compose, `.env.example` và operations docs.

Hình đề xuất: deployment topology local và staging.

## Chương 8 — Kết quả, giới hạn và hướng phát triển

Đối chiếu yêu cầu với bằng chứng, nêu phần đã verified, phân tích debt/risk và
tách ý tưởng tương lai khỏi công việc bắt buộc chưa hoàn thành.

Nguồn chính: acceptance matrix, risk register, technical debt, known
limitations, completion definition và [sổ đăng ký bằng chứng](evidence-register.md).

## Phụ lục

Nên kèm danh mục endpoint, message WebSocket, migration, DDL chọn lọc, SQL kiểm
tra invariant, test inventory, bảng benchmark, ADR register, demo checklist,
[sổ đăng ký bằng chứng](evidence-register.md), danh mục sơ đồ và bằng chứng
deployment đã loại dữ liệu nhạy cảm.
