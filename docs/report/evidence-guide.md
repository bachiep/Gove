# Hướng Dẫn Thu Thập Bằng Chứng Báo Cáo

Trạng thái: Đang cập nhật
Cập nhật lần cuối: 2026-09-24

## Quy tắc chung

Một claim chỉ được dùng trong phần kết quả khi có artifact tái lập được. Source
code chứng minh implementation tồn tại; test pass chứng minh behavior đã được
kiểm thử; screenshot chứng minh UI đã chạy; benchmark chứng minh đúng workload
đã đo; deployment evidence chứng minh đúng môi trường đã triển khai.

## Ma trận claim và bằng chứng

| Claim trong báo cáo                         | Bằng chứng tối thiểu                                          |
| ------------------------------------------- | ------------------------------------------------------------- |
| Build thành công                            | `npm run check` tại commit được ghi nhận                      |
| Matching loại Driver stale                  | Integration test và policy freshness                          |
| Chỉ một request giữ được Driver             | Race test lặp lại và SQL invariant query                      |
| Retry không tạo Trip/Payment/Delivery trùng | Idempotency integration test                                  |
| Realtime phục hồi sau reconnect             | Browser/E2E flow gồm HTTP snapshot và event mới               |
| Database là source of truth                 | ADR, transaction code, migration, failure behavior            |
| Backup có thể restore                       | Restore vào database sạch và smoke check                      |
| Có thể rollback ứng dụng                    | Redeploy image/commit trước mà không xóa volume               |
| Đạt throughput/latency                      | Benchmark report có workload, môi trường và percentile        |
| Đã deploy                                   | Host định danh, health, TLS/WSS, port review và browser smoke |

## Ảnh chụp nên có

- Customer tạo và hoàn thành Ride.
- Driver nhận Offer và chuyển lifecycle.
- Customer tạo/theo dõi Delivery sau khi tính năng hoàn thành.
- Driver xác nhận custody và proof.
- Swagger/OpenAPI endpoint groups.
- Health/readiness qua staging proxy.
- Test summary, migration summary và benchmark summary.
- Database invariant query trả về zero violations.

## Không dùng làm bằng chứng

- Output được viết lại thủ công.
- Benchmark không ghi cấu hình hoặc chỉ đo health nhưng kết luận matching.
- Screenshot chứa token, secret hoặc dữ liệu cá nhân.
- Tuyên bố production-ready chỉ vì Docker chạy được.
- Tài liệu thiết kế chưa được đối chiếu với code.

## Metadata cần giữ

Mỗi evidence record cần commit SHA, ngày giờ, OS/runtime/container version,
command, dataset, cấu hình, kết quả, giới hạn và người kiểm tra. Raw log có thể
để ngoài Git; report tóm tắt đã loại dữ liệu nhạy cảm được commit.
