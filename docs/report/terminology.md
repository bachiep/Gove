# Thuật Ngữ Song Ngữ Dùng Trong Báo Cáo

Trạng thái: Hiện hành
Cập nhật lần cuối: 2026-09-24

Tài liệu này thống nhất cách gọi giữa báo cáo tiếng Việt và implementation.
Thuật ngữ kỹ thuật, identifier trong code, label trong sơ đồ, state, command và
event giữ nguyên tiếng Anh. Phần diễn giải nghiệp vụ dùng tiếng Việt.

| Thuật ngữ chuẩn      | Diễn giải dùng trong báo cáo                                                       |
| -------------------- | ---------------------------------------------------------------------------------- |
| Customer             | Khách hàng yêu cầu chuyến đi hoặc giao hàng                                        |
| Driver               | Tài xế đủ điều kiện nhận Ride hoặc Delivery                                        |
| Operator             | Nhân sự vận hành theo dõi và can thiệp trong phạm vi được cấp quyền                |
| Ride                 | Dịch vụ vận chuyển hành khách                                                      |
| Trip                 | Aggregate biểu diễn một chuyến Ride cụ thể                                         |
| Delivery             | Aggregate biểu diễn một yêu cầu giao hàng                                          |
| Parcel               | Kiện hàng được vận chuyển trong Delivery                                           |
| Pickup               | Điểm hoặc hoạt động nhận hành khách/hàng                                           |
| Dropoff              | Điểm hoặc hoạt động trả hành khách/hàng                                            |
| Recipient            | Người nhận hàng                                                                    |
| Fare Quote           | Báo giá có thời hạn, chứa snapshot của pricing rule                                |
| Latest Location      | Vị trí hợp lệ mới nhất của Driver                                                  |
| Historical Location  | Lịch sử vị trí, hiện không phải phạm vi bắt buộc của MVP                           |
| Dispatch             | Quá trình chọn, giữ chỗ và gửi Offer cho Driver                                    |
| Candidate            | Driver được tìm thấy trước bước lọc eligibility                                    |
| Eligibility          | Tập điều kiện để Driver được phép nhận một công việc                               |
| Reservation          | Quyền giữ Driver có thời hạn trong quá trình Dispatch                              |
| Offer                | Lời mời có thời hạn gửi tới Driver                                                 |
| Assignment           | Quan hệ phân công đã được xác nhận giữa Driver và Trip/Delivery                    |
| Driver Work State    | Trạng thái công việc dùng chung để ngăn Driver nhận đồng thời Ride và Delivery     |
| State Transition     | Một lần chuyển trạng thái hợp lệ của aggregate                                     |
| Aggregate Version    | Số phiên bản tăng dần dùng để kiểm soát concurrency và ordering                    |
| Idempotency Key      | Khóa giúp một command retry không tạo thêm business effect                         |
| Command Receipt      | Bản ghi bền vững chứa fingerprint và response của command idempotent               |
| Transactional Outbox | Event được ghi cùng transaction với state change để tránh dual-write inconsistency |
| Projection           | Dữ liệu phía client được dựng từ authoritative snapshot và event                   |
| Source of Truth      | Nguồn dữ liệu có thẩm quyền khi các bản sao không đồng nhất                        |
| Strong Consistency   | Tính nhất quán bắt buộc ngay tại transaction boundary                              |
| Eventual Consistency | Tính nhất quán đạt được sau khi event/projection được xử lý                        |
| Custody Confirmation | Xác nhận Driver đã nhận trách nhiệm đối với Parcel                                 |
| Delivery Proof       | Bằng chứng hoàn thành Delivery                                                     |
| Payment Attempt      | Một lần yêu cầu payment simulation cho Trip                                        |
| Reconciliation       | Đối soát trạng thái Payment với nguồn giao dịch có thẩm quyền                      |
| Realtime Gateway     | WebSocket boundary phát projection; không sở hữu business state                    |
| Liveness             | Kiểm tra tiến trình còn hoạt động                                                  |
| Readiness            | Kiểm tra tiến trình sẵn sàng phục vụ cùng dependency bắt buộc                      |
| Stale Location       | Vị trí đã quá freshness threshold và không còn hợp lệ cho Dispatch                 |
| Bounded Context      | Biên mô hình có ngôn ngữ và quyền sở hữu dữ liệu riêng                             |

## Quy ước trình bày

- Viết `Driver`, `Trip`, `Delivery`, `Offer`, `Payment` khi nói về khái niệm
  domain đúng như code; không dịch label trong sơ đồ thành từ gần nghĩa.
- Giữ nguyên các state như `MATCHING`, `IN_TRIP`, `DELIVERED` và event như
  `trip.created`, `payment.succeeded`.
- Có thể giải thích lần đầu theo mẫu “`Reservation` (giữ chỗ Driver có thời
  hạn)”, sau đó dùng thuật ngữ tiếng Anh nhất quán.
- Tên bảng, cột, endpoint, HTTP method, constraint và filename luôn đặt trong
  code span và giữ nguyên chính tả của repository.
