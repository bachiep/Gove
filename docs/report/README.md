# Bộ Tài Liệu Phục Vụ Báo Cáo

Trạng thái: Đang cập nhật
Cập nhật lần cuối: 2026-09-24

Thư mục này là nguồn tài liệu kỹ thuật để viết báo cáo học thuật. Nội dung ở
đây không thay thế bản thuyết minh hoàn chỉnh; nó cung cấp sơ đồ đã đối chiếu,
tham chiếu schema, vị trí bằng chứng và ánh xạ chương để mọi nhận định trong báo
cáo đều có thể truy ngược tới implementation.

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

## Quy tắc quản lý sơ đồ

Mermaid trong thư mục này là nguồn sự thật được quản lý bằng Git. GitHub có thể
render trực tiếp và có thể xuất SVG hoặc PNG để chèn vào báo cáo. Bản sao trên
FigJam/Figma chỉ phục vụ trình bày, không được tự thêm thành phần, quan hệ,
trạng thái hoặc bằng chứng không tồn tại trong repository.

Mỗi sơ đồ phải ghi rõ nó mô tả implementation hiện tại, thiết kế đã chấp nhận
hay phần việc còn dự kiến. Không được trình bày nội dung Planned như nội dung đã
Implemented.

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
