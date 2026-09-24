# Payment Provider Integration Baseline

Status: Implemented baseline / integration pending
Last reviewed: 2026-09-24

## Mục đích và phạm vi

Tài liệu này mô tả chính xác trạng thái Payment Provider hiện tại của Gove.
Nó phân biệt simulator có thể dùng để kiểm thử luồng thanh toán với các
provider ngoài đang được chuẩn bị contract.

- `SIMULATOR` đã được triển khai và dùng được trong môi trường hiện tại.
- `MOMO` và `SEPAY` chỉ tạo một `Payment Attempt` có trạng thái `PENDING`.
- Không có API call ra MoMo hoặc SePay.
- Không tạo QR thanh toán, không nhận webhook, không xác minh chữ ký, và
  không nhận tiền thật.

Vì vậy, một `PENDING` attempt của `MOMO` hoặc `SEPAY` không phải là bằng chứng
khách hàng đã thanh toán; nó chỉ là một record có chủ đích để giữ chỗ cho luồng
tích hợp thật.

## Provider contract hiện tại

Payment service dùng adapter nội bộ để lập kế hoạch kết quả capture:

```text
PaymentProviderAdapter
  provider: SIMULATOR | MOMO | SEPAY
  planCapture({ simulationOutcome? })
    -> { provider, status, providerReference, failureCode }
```

| Provider    | Hành vi hiện tại                                                        | `providerReference`                | Kết quả có thể có                           |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------- |
| `SIMULATOR` | Lập Payment Attempt theo `simulationOutcome` hoặc mặc định `SUCCEEDED`. | Có khi `SUCCEEDED`, dạng `sim-...` | `SUCCEEDED`, `FAILED`, `PENDING`, `UNKNOWN` |
| `MOMO`      | Không gọi endpoint bên ngoài; tạo attempt chờ.                          | `null`                             | `PENDING`                                   |
| `SEPAY`     | Không gọi endpoint bên ngoài; tạo attempt chờ.                          | `null`                             | `PENDING`                                   |

API hiện tại là `POST /payments/trips/:tripId/capture`. API yêu cầu Customer
đã xác thực, Trip thuộc Customer đó, Trip đang `COMPLETED` và có final fare.
Request body chấp nhận `provider`; `simulationOutcome` chỉ được phép với
`SIMULATOR`. Provider ngoài không nhận secret, token hay thông tin tài khoản
trong request của client.

## Quy tắc trạng thái và idempotency

Mỗi Payment Attempt gắn với một Trip hoàn thành, amount/currency cuối cùng của
Trip, provider, trạng thái và số thứ tự attempt. Capture command có các quy tắc
sau:

- Header `Idempotency-Key` là bắt buộc, dài từ 8 đến 128 ký tự.
- Khóa được phạm vi theo Customer, operation `CAPTURE_PAYMENT` và request
  fingerprint. Gọi lại với cùng payload trả về response đã lưu; tái sử dụng
  cùng key với payload khác bị từ chối.
- Fingerprint bao gồm Trip, provider và `simulationOutcome` (nếu có), nên đổi
  provider không thể dùng lại key của request cũ.
- Transaction PostgreSQL lấy advisory lock trên Customer và idempotency key,
  sau đó khóa receipt, Trip và Payment Attempt mới nhất để tránh tạo attempt
  trùng do request đồng thời.
- Attempt `PENDING`, `SUCCEEDED` hoặc `UNKNOWN` chặn một capture attempt mới.
  Chỉ `FAILED` mới cho phép thử lại bằng idempotency key mới.

`UNKNOWN` là kết quả cần reconciliation, không được coi là thất bại để tự động
thử lại. Với `MOMO` và `SEPAY` baseline, attempt sẽ ở `PENDING` cho đến khi có
luồng webhook/reconciliation được triển khai và xác minh.

## Source of truth

PostgreSQL là source of truth cho Payment Attempt, command receipt và payment
outbox event. Response từ client, dữ liệu hiển thị QR trong tương lai, hoặc
thông báo WebSocket không có quyền quyết định payment state.

Khi tích hợp provider thật, webhook đã xác thực và kết quả truy vấn/reconcile
từ API provider phải là nguồn xác minh outcome bên ngoài. Client chỉ được hiển
thị trạng thái do backend trả về và không được tự chuyển `PENDING` sang
`SUCCEEDED`.

## Lộ trình tích hợp provider thật

1. Đăng ký môi trường sandbox trước; chỉ cân nhắc production credentials sau
   khi sandbox, callback và reconciliation đạt acceptance criteria.
2. Lưu credentials, signing secret, callback URL và allowlist IP trong secret
   manager hoặc biến môi trường triển khai. Không commit chúng vào Git, test
   fixture, log hay response API.
3. Thay adapter `MOMO`/`SEPAY` pending bằng client server-to-server có timeout,
   retry policy rõ ràng và idempotency mapping giữa Gove và provider.
4. Tạo payment instruction/QR từ backend; lưu provider transaction reference
   và thời hạn thanh toán trước khi trả dữ liệu hiển thị cho client.
5. Cung cấp webhook endpoint riêng: kiểm tra chữ ký, timestamp, schema,
   provider reference và trạng thái chuyển đổi hợp lệ. Lưu raw audit metadata
   đã được redaction khi cần, không lưu secret.
6. Thực hiện replay protection bằng event identifier/provider reference duy
   nhất, timestamp window và receipt/idempotency record. Webhook trùng phải an
   toàn, không phát sinh settlement hoặc event trùng.
7. Bổ sung reconciliation định kỳ và theo yêu cầu cho `PENDING`/`UNKNOWN`;
   đối chiếu amount, currency, provider reference, status và thời điểm với API
   provider. Escalate các sai lệch để vận hành xử lý thay vì tự suy đoán.
8. Chỉ sau khi callback, reconciliation và rollback được kiểm thử mới cho phép
   sử dụng tiền thật; cập nhật tài liệu này bằng evidence đo được.

## Test và acceptance criteria

Baseline hiện tại cần duy trì các kiểm tra sau:

- Unit test adapter: simulator trả đúng outcome; `MOMO` và `SEPAY` luôn lập
  `PENDING` và không có provider reference.
- Integration test capture: Customer không sở hữu Trip bị từ chối; Trip chưa
  hoàn thành bị từ chối; key idempotency trả lại receipt; key bị tái sử dụng với
  payload khác bị từ chối.
- Integration test trạng thái: `PENDING`, `SUCCEEDED` và `UNKNOWN` chặn attempt
  mới; `FAILED` cho phép retry với key khác.
- Regression test schema: provider ngoài từ chối `simulationOutcome` và request
  body không chứa trường ngoài contract.
- Kiểm tra migration: cột `provider` chỉ nhận `SIMULATOR`, `MOMO` hoặc `SEPAY`.

Acceptance criteria để gọi một provider ngoài là **integrated** gồm tối thiểu:

- Có sandbox test thành công qua API provider thật.
- QR/instruction trả về từ backend và không làm lộ secret.
- Webhook signature, replay protection và state transition được kiểm thử bằng
  callback hợp lệ, callback giả mạo, callback muộn và callback trùng.
- Reconciliation phát hiện và xử lý được mismatch/timeout.
- E2E evidence chứng minh một attempt được settle theo dữ liệu provider, không
  chỉ theo dữ liệu client.

## Giới hạn hiện tại

- Không có MoMo/SePay API client, QR, deeplink, webhook hoặc reconciliation.
- Không có chứng cứ sandbox hay giao dịch tiền thật.
- `PENDING` attempt ngoài có thể chặn capture tiếp theo cho cùng Trip cho tới
  khi quy trình reconciliation/resolution được xây dựng.
- Chưa có chính sách refund, chargeback, phí provider, expiry, cancellation
  settlement hoặc vận hành đối soát thủ công.

Các giới hạn này là trạng thái thiết kế hiện tại, không phải tuyên bố về năng
lực thanh toán thực tế.
