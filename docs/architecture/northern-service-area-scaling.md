# Mở rộng vùng phục vụ miền Bắc theo giai đoạn

## Trạng thái

**Designed / Planned** — tài liệu này là quyết định mở rộng theo giai đoạn,
không xác nhận bất kỳ vùng nào ngoài phạm vi hiện tại đã được triển khai hoặc
vận hành.

## Quyết định

Gove bắt đầu với vùng demo nội thành Hà Nội và chỉ mở rộng dần ra miền Bắc sau
khi mỗi vùng mới vượt qua các tiêu chí kỹ thuật, nghiệp vụ và vận hành dưới
đây. Phạm vi địa lý không được mở rộng chỉ vì node có còn RAM, CPU hoặc ổ đĩa;
quyết định phải dựa trên bằng chứng đo được cho phiên bản dữ liệu, workload và
runtime cụ thể.

| Giai đoạn | Phạm vi                                                                      | Trạng thái         |
| --------- | ---------------------------------------------------------------------------- | ------------------ |
| 1         | Hà Nội nội thành: latitude `20.98–21.10`, longitude `105.76–105.90`          | Designed / Planned |
| 2         | Các khu vực lân cận Hà Nội được xác định bằng polygon/service-area versioned | Planned            |
| 3         | Các tỉnh, thành miền Bắc được phê duyệt theo từng rollout                    | Planned            |

Bounding box giai đoạn 1 là giới hạn demo ban đầu, không phải ranh giới hành
chính hoặc cam kết phủ sóng thực tế. Khi mở rộng, service area phải dùng dữ liệu
versioned có thể truy vết thay vì tăng một bounding box không kiểm soát.

## Điều kiện mở rộng an toàn

Một rollout sang vùng mới chỉ được phê duyệt khi tất cả điều kiện áp dụng đã có
bằng chứng kiểm chứng được.

### Routing và dữ liệu bản đồ

- OSRM dùng extract miền Bắc phù hợp với vùng rollout; data source, license,
  checksum, ngày cập nhật, OSRM version và profile được ghi nhận.
- Route contract được kiểm tra với điểm pickup/dropoff hợp lệ, `NoRoute`, dữ
  liệu hỏng, timeout và fallback. Fallback phải tiếp tục được gắn nhãn là ước
  tính theo tọa độ, không phải road route.
- Không commit `.osm.pbf`, graph đã preprocess hoặc tile archive vào Git.
- Map matching, nếu được thêm sau này, chỉ là derived presentation data; raw
  location/PostGIS vẫn là source of truth cho dispatch và business state.

### Giá, dịch vụ và quy tắc nghiệp vụ

- Pricing service area, service availability, fare rules, cancellation rules và
  address/coordinate validation được cấu hình hoặc versioned cho vùng mới.
- Ride và Delivery fixtures có điểm hợp lệ, điểm ngoài vùng và hành trình biên
  vùng; integration tests phải chứng minh các rule này.
- Không hiển thị một service như đã phục vụ ở vùng mới khi backend vẫn từ chối
  request hoặc routing không có dữ liệu tương ứng.

### Benchmark tài nguyên và tải

- Benchmark trên các runtime dự kiến: PC development/full stack và PhoneGrid
  LG V50 staging (API, web và PostgreSQL). OSRM được đo riêng trước khi được
  ghép vào node chung.
- Báo cáo workload, dataset, thời lượng, concurrency, cấu hình, phiên bản phần
  mềm, CPU/RAM/storage/network, p50/p95/p99 phù hợp và giới hạn quan sát được.
- Kiểm tra resource exhaustion, restart/recovery và trạng thái fallback khi
  routing dependency không sẵn sàng.
- Không suy ra capacity, coverage hay SLA của vùng mới từ thông số thiết bị,
  benchmark ở vùng khác hoặc số liệu của nhà cung cấp.

### Observability và vận hành

- Dashboard/log có correlation ID phải phân biệt được request theo service-area
  version, routing provider/data version, fallback reason và lỗi pricing.
- Có health check cho API, PostgreSQL, routing endpoint nếu được cấu hình, cùng
  cảnh báo về lỗi route, fallback rate, request rejection và resource pressure.
- PhoneGrid là supervisor duy nhất của node LG; backup PostgreSQL được mã hóa và
  kiểm tra restore về máy Linux trong LAN theo runbook.
- Quick Tunnel chỉ phục vụ phiên demo. Nó không là endpoint webhook payment ổn
  định hay bằng chứng cho deployment production.

### Test, rollout và rollback

- Test unit, integration, contract, concurrency và browser acceptance phù hợp
  với vùng mới phải xanh trước rollout.
- Rollout dùng service-area version/feature flag có owner, thời điểm bắt đầu,
  tiêu chí dừng và evidence log/metric.
- Rollback phải có khả năng trả về service-area và OSRM dataset/version trước;
  không sửa trực tiếp historical Trip, Delivery, fare quote hoặc payment record.
- Sau rollback, test smoke xác nhận vùng cũ vẫn quote, create request, dispatch
  và render map/fallback đúng.

## Trình tự đề xuất

```text
Hà Nội inner-city verified
        ↓
Northern extract + pricing/service rules prepared
        ↓
PC and PhoneGrid benchmark + observability evidence
        ↓
Limited feature-flag rollout
        ↓
Acceptance and rollback rehearsal
        ↓
Approve next Northern service area
```

Mỗi vùng miền Bắc là một rollout độc lập. Việc mở rộng không tự động chuyển
Gove thành nền tảng toàn miền Bắc, điều hướng giao thông thời gian thực, hay hệ
thống có capacity/SLA chưa được đo và công bố bằng evidence.
