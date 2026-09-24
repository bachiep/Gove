# Danh Mục Sơ Đồ

Trạng thái: Đang cập nhật
Cập nhật lần cuối: 2026-09-24

| ID   | Sơ đồ                     | Mục đích                                   | Nguồn sự thật                  | Trạng thái                                        |
| ---- | ------------------------- | ------------------------------------------ | ------------------------------ | ------------------------------------------------- |
| D-01 | System context            | Actor và boundary bên ngoài                | Charter, requirements          | Hiện hành                                         |
| D-02 | Runtime architecture      | Đơn vị triển khai và datastore             | Architecture, Compose          | Hiện hành                                         |
| D-03 | Module ownership          | Boundary nội bộ và dữ liệu sở hữu          | App module, data ownership     | Hiện hành                                         |
| D-04 | Deployment topology       | Network exposure local/staging             | Compose, deployment runbook    | Hiện hành                                         |
| D-05 | Security trust boundary   | Browser, ingress, API, database, secret    | Security/deployment docs       | Thiết kế hiện hành                                |
| D-06 | Năng lực actor Ride       | Tương tác Customer, Driver, Operator       | MVP requirements               | Hỗn hợp, có ghi nhãn                              |
| D-07 | Năng lực actor Delivery   | Parcel slice đầu tiên                      | M7 requirements                | Hỗn hợp, có ghi nhãn                              |
| D-08 | State machine Trip        | Lifecycle hợp lệ và trạng thái kết thúc    | Trip lifecycle, SQL            | Hiện hành                                         |
| D-09 | State machine Delivery    | Custody lifecycle và trạng thái kết thúc   | Delivery lifecycle, SQL        | Hiện hành; hoãn cancellation                      |
| D-10 | Sequence xác thực         | Login và rotating refresh session          | Auth API, implementation       | Hiện hành                                         |
| D-11 | Luồng Ride thành công     | Fare Quote đến settlement mô phỏng         | API contract, tests            | Hiện hành                                         |
| D-12 | Luồng Delivery thành công | Request đến recipient proof                | Delivery API, tests            | Backend hiện hành; Customer UI/realtime còn thiếu |
| D-13 | Tranh chấp Driver         | Transaction chỉ cho phép một bên thắng     | Dispatch/Delivery repositories | Thiết kế hiện hành; thiếu stress test liên domain |
| D-14 | Idempotency Payment       | Retry chỉ tạo một business effect          | Payment API, tests             | Hiện hành                                         |
| D-15 | Realtime reconnect        | Lấy HTTP authority trước khi subscribe lại | Realtime contract, tests       | Hiện hành                                         |
| D-16 | ERD Identity/Driver       | Dữ liệu xác thực và eligibility            | Migration 0002–0003            | Hiện hành                                         |
| D-17 | ERD Ride/Dispatch/Payment | Persistence cốt lõi của Ride               | Migration 0004–0006            | Hiện hành                                         |
| D-18 | ERD Delivery              | Parcel, custody, proof, dispatch           | Migration 0007–0009            | Hiện hành                                         |

## Checklist xuất hình

- Ưu tiên SVG; chỉ dùng PNG khi công cụ viết báo cáo yêu cầu.
- Bảo đảm chữ đọc được ở chiều rộng trang in.
- Mỗi hình chỉ nên trình bày một bounded context hoặc một scenario.
- Ghi số hình, tiêu đề, trạng thái implementation và commit nguồn.
- Xuất lại hình sau khi Mermaid thay đổi; không chỉnh riêng file ảnh thành một
  nguồn sự thật khác.
