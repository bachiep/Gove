# Bộ Tài Liệu Phục Vụ Báo Cáo

Trạng thái: Đang cập nhật
Cập nhật lần cuối: 2026-09-25

Thư mục này là nguồn tài liệu kỹ thuật để viết báo cáo học thuật. Nội dung ở
đây không thay thế bản thuyết minh hoàn chỉnh; nó cung cấp sơ đồ đã đối chiếu,
tham chiếu schema, vị trí bằng chứng và ánh xạ chương để mọi nhận định trong báo
cáo đều có thể truy ngược tới implementation.

## Quy tắc chọn evidence hiện tại

Các snapshot mang ngày 2026-09-24 trong `docs/testing` và `docs/report` là tài
liệu lịch sử, đã bị evidence ngày 2026-09-25 supersede khi mô tả trạng thái hiện
tại. Người viết báo cáo phải ưu tiên [Sổ Đăng Ký Bằng Chứng](evidence-register.md),
[Browser Acceptance Record 2026-09-25](../testing/browser-acceptance-2026-09-25.md)
và [Migration Replay Evidence 2026-09-25](../testing/migration-replay-2026-09-25.md).
[`benchmark-smoke-2026-09-24.md`](../testing/benchmark-smoke-2026-09-24.md) vẫn
chỉ là smoke measurement lịch sử; chưa có benchmark capacity 2026-09-25 thay
thế nó.

## Nội dung

- [Khung báo cáo](report-outline.md): cấu trúc chương và nguồn tài liệu cho từng
  chương.
- [Danh mục sơ đồ](diagram-catalog.md): mục đích, nguồn sự thật và trạng thái
  implementation của từng hình.
- [Sơ đồ kiến trúc](diagrams/architecture.md): context, runtime, deployment,
  quyền sở hữu module và trust boundary.
- [Sơ đồ domain và use case](diagrams/domain-and-use-cases.md): năng lực của actor
  cùng state machine của Trip và Delivery.
- [Sơ đồ tuần tự](diagrams/sequences.md): xác thực, Ride, Delivery, Payment và
  tranh chấp Driver.
- [Sơ đồ dữ liệu](diagrams/data-model.md): các ERD tách theo bounded context và
  được suy ra từ SQL migration.
- [Sơ đồ Map và Routing](diagrams/map-and-routing.md): provider seam,
  coordinate fallback và route provenance.
- [Sơ đồ Operator và Audit](diagrams/operator-and-audit.md): diagnostics,
  onboarding review và idempotency receipt.
- [Sơ đồ Verification Gates](diagrams/verification-gates.md): cách nối
  requirement với evidence trước khi đưa claim vào báo cáo.
- [Tham chiếu cơ sở dữ liệu](database-reference.md): migration, invariant SQL và
  nội dung dùng cho chương cài đặt.
- [Danh mục API và event](api-and-event-catalog.md): endpoint, role, mục đích,
  WebSocket message và transactional outbox event.
- [Thuật ngữ song ngữ](terminology.md): tên tiếng Anh chuẩn dùng thống nhất trong
  code, sơ đồ và báo cáo, kèm diễn giải tiếng Việt.
- [SQL kiểm chứng](sql/verification-queries.sql): truy vấn chỉ đọc phục vụ
  nghiệm thu và chụp bằng chứng.
- [Hướng dẫn bằng chứng](evidence-guide.md): được phép kết luận điều gì và artifact
  nào chứng minh kết luận đó.
- [Sổ đăng ký bằng chứng](evidence-register.md): checklist traceability theo
  claim, chương báo cáo và gate nghiệm thu; không ghi activity log.

## Quy tắc quản lý sơ đồ

Mermaid trong thư mục này là nguồn sự thật được quản lý bằng Git. GitHub có thể
render trực tiếp và có thể xuất SVG hoặc PNG để chèn vào báo cáo. Bản sao trên
FigJam/Figma chỉ phục vụ trình bày, không được tự thêm thành phần, quan hệ,
trạng thái hoặc bằng chứng không tồn tại trong repository.

Mỗi sơ đồ phải ghi rõ nó mô tả implementation hiện tại, thiết kế đã chấp nhận
hay phần việc còn dự kiến. Không được trình bày nội dung Planned như nội dung đã
Implemented.

Danh mục sơ đồ phải bao gồm cả các boundary kỹ thuật phát sinh trong quá trình
implementation. Hiện tại routing/map, Operator/audit và verification gates
được lập thành D-19–D-21; trạng thái evidence của chúng vẫn phải đọc cùng
acceptance matrix.

Phần thuyết minh và chú thích học thuật được viết bằng tiếng Việt. Tên kỹ thuật
bên trong sơ đồ như component, actor, state, command, event, endpoint, bảng,
cột và constraint giữ nguyên tiếng Anh để thống nhất với source code và thông
lệ chuyên môn; không dịch các identifier này sang tiếng Việt.

## Quy tắc sử dụng trong báo cáo

1. Dùng sơ đồ để giải thích, không dùng thay cho phần phân tích.
2. Ghi phạm vi và trạng thái dưới mỗi hình, ví dụ
   `Đã triển khai và kiểm thử cục bộ tại commit <sha>`.
3. Dẫn tên migration cho nhận định về dữ liệu; dẫn test/report cho nhận định về
   correctness hoặc performance.
4. Che access token, secret, email, số điện thoại, tọa độ đầy đủ và đường dẫn
   máy cá nhân khỏi ảnh chụp và bằng chứng thô.
5. Cập nhật bộ tài liệu trong cùng thay đổi nếu implementation làm sơ đồ hoặc
   nhận định cũ không còn đúng.
