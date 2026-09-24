# Browser Acceptance Follow-up — 2026-09-24

Trạng thái: kiểm thử thực tế trên local, phạm vi chưa phải full acceptance.

> **Snapshot lịch sử — đã supersede về trạng thái hiện tại (2026-09-25).**
> Phần kiểm thử ngày 2026-09-24 dưới đây được giữ để truy vết lịch sử. Khi
> viết báo cáo, dùng [Browser Acceptance Record ngày 2026-09-25](browser-acceptance-2026-09-25.md)
> làm nguồn hiện tại; phần bổ sung 2026-09-25 trong tài liệu này chỉ là chi
> tiết phụ trợ.

## Phạm vi và môi trường

- Browser: Chrome local hiện có, điều khiển bằng Browser Harness qua CDP.
- Không khởi động cloud browser.
- Web runtime: `http://localhost:5173` và `http://127.0.0.1:5173`.
- API runtime được ứng dụng sử dụng qua Vite proxy tại `/api/v1`.
- Desktop viewport quan sát được: `1440 × 900`.
- Mobile viewport quan sát được: `390 × 844` và `375 × 812`.
- Session setup:
  - Customer: synthetic local Customer session có sẵn trong Chrome; không ghi credential.
  - Driver: synthetic Driver account được đăng ký bằng UI trong host `127.0.0.1`; mật khẩu và token không được ghi. Profile và vehicle được gửi để tạo trạng thái chờ duyệt.
- Dữ liệu tạo trong lần kiểm thử là dữ liệu synthetic local. Không sử dụng dữ liệu cá nhân thực.

## Kết quả quan sát được

| Scenario                 | Quan sát thực tế                                                                                                                                                                                                                | Kết luận                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Customer mở ride request | `http://localhost:5173/ride/request` render đúng màn hình `Đặt chuyến`, có form pickup/dropoff, service type, Leaflet map và nút `Xem giá ước tính`.                                                                            | Đã quan sát                                       |
| Fare quote               | Submit form với điểm mô phỏng hiển thị `36.836 ₫`, `3.1 km`, service `Xe máy tiêu chuẩn` và thời hạn quote khoảng 5 phút.                                                                                                       | Đã quan sát                                       |
| Customer tạo Trip        | Sau khi retry khi API đã sẵn sàng, UI hiển thị `ĐÃ GHI NHẬN YÊU CẦU`, mã chuyến, cước ước tính và state `Chưa tìm thấy Tài xế`.                                                                                                 | Đã quan sát                                       |
| Trip realtime state      | UI hiển thị `Đã kết nối trạng thái chuyến trực tiếp`; map hiển thị pickup/dropoff và ghi rõ chưa có vị trí Driver.                                                                                                              | Đã quan sát                                       |
| Vietnamese UI            | Header, form, state labels, lỗi và account screen hiển thị tiếng Việt. Một lỗi eligibility từ API vẫn hiển thị nguyên văn tiếng Anh: `The Driver is not eligible to go online.`                                                 | Đã quan sát; còn khác biệt ngôn ngữ ở lỗi backend |
| Customer session reload  | Sau `location.reload()` trên `localhost`, trang vẫn ở trạng thái authenticated với `Đăng xuất`, không hiển thị màn hình đăng nhập và form ride vẫn render. Đây là kiểm tra reload, không phải kiểm tra đóng/mở toàn bộ browser. | Đã quan sát                                       |
| Delivery request         | `http://localhost:5173/delivery/request` hiển thị form pickup, dropoff, recipient, phone, parcel description và declared weight.                                                                                                | Đã quan sát                                       |
| Customer tạo Delivery    | Submit dữ liệu synthetic tạo đơn thành công; UI hiển thị `ĐÃ GHI NHẬN ĐƠN HÀNG`, state `Chưa tìm thấy Tài xế`, trạng thái realtime và tracking map.                                                                             | Đã quan sát                                       |
| Delivery history/detail  | `Xem lịch sử gửi hàng` mở `/account`; row delivery và detail hiển thị state, pickup, dropoff, recipient, parcel description, weight và version.                                                                                 | Đã quan sát                                       |
| Driver onboarding        | `/register` cho phép chọn `Tài xế`; sau đăng nhập, `/driver/setup` hiển thị form profile/vehicle. Submit hiển thị `Đã lưu hồ sơ. Tài khoản Tài xế đang chờ duyệt.`                                                              | Đã quan sát                                       |
| Driver Console           | Với synthetic Driver session trong cùng SPA navigation, `/driver/console` hiển thị trạng thái `Đang offline`, nút `Bật nhận chuyến`, không có delivery offer, trip offer hoặc current trip.                                     | Đã quan sát                                       |
| Driver eligibility       | Bấm `Bật nhận chuyến` khi profile chưa được duyệt hiển thị `The Driver is not eligible to go online.` và nút `Thử tải lại`.                                                                                                     | Đã quan sát                                       |

## Responsive/mobile evidence

Các phép đo DOM sau được lấy từ trang đã render:

- Ride request tại `390 × 844`: `document.documentElement.scrollWidth = 390`; không có horizontal overflow.
- Delivery request tại `375 × 812`: `document.documentElement.scrollWidth = 375`, `document.body.scrollWidth = 375`; không có horizontal overflow; header và nút `Tạo đơn gửi hàng` tồn tại trong DOM.
- Driver Console tại `375 × 812`: `document.documentElement.scrollWidth = 375`, `document.body.scrollWidth = 375`; các nút điều khiển chính vẫn tồn tại.

Các phép đo này xác nhận layout không tạo overflow ngang trong những trạng thái đã kiểm tra; chưa phải đánh giá đầy đủ về usability trên mọi thiết bị.

## Screenshot evidence

Ảnh chụp viewport được lưu ngoài repository trong lần kiểm thử:

- `/tmp/gove-followup-customer-restored.png`
- `/tmp/gove-followup-customer-session-reload.png`
- `/tmp/gove-followup-customer-fare-quote.png`
- `/tmp/gove-followup-customer-trip-retry.png`
- `/tmp/gove-followup-customer-mobile.png`
- `/tmp/gove-followup-delivery-form.png`
- `/tmp/gove-followup-delivery-created.png`
- `/tmp/gove-followup-delivery-history.png`
- `/tmp/gove-followup-delivery-detail.png`
- `/tmp/gove-followup-delivery-mobile.png`
- `/tmp/gove-followup-driver-setup-saved.png`
- `/tmp/gove-followup-driver-console-role.png`
- `/tmp/gove-followup-driver-availability-rejected.png`
- `/tmp/gove-followup-driver-mobile.png`

## Failures and harness limitations

1. Có một lần bấm `Đặt chuyến` trả về UI generic `Có lỗi xảy ra. Vui lòng thử lại.` đúng lúc API dev process đang hot-restart; Vite ghi nhận proxy `ECONNREFUSED 127.0.0.1:3000`. Sau khi API sẵn sàng, retry từ chính UI tạo Trip thành công.
2. Coordinate click helper của local Browser Harness đã timeout trong session này. Vì vậy các interaction còn lại dùng DOM/AX evidence (`form.requestSubmit()`, element click và kiểm tra rendered text/URL) rồi xác nhận kết quả sau render; không dùng HTTP response đơn thuần để kết luận UI.
3. Trên host `127.0.0.1`, sau khi đăng nhập Driver rồi hard-navigate trực tiếp tới `/driver/console`, app hiển thị `Đăng nhập để tiếp tục.`. Driver Console đã được kiểm tra thành công bằng SPA navigation trong cùng session. Session restore giữa hai host/origin này chưa được coi là đạt.

## Remaining gaps — chưa được tuyên bố là đạt

- Chưa quan sát được một Driver được operator approve rồi nhận offer Ride/Delivery trong browser.
- Chưa quan sát được full Ride lifecycle qua browser: `ACCEPTED` → `PICKING_UP` → `IN_TRIP` → `COMPLETED`.
- Chưa quan sát được Delivery custody lifecycle qua browser: `DRIVER_TO_PICKUP` → `AT_PICKUP` → `IN_TRANSIT` → `DELIVERED`.
- Chưa quan sát được Driver GPS movement thực tế, marker di chuyển, road route hoặc road-network ETA; màn hình hiện vẫn ghi rõ route thực tế và background GPS là phần milestone sau.
- Chưa kiểm tra browser close/reopen, WebSocket disconnect/reconnect trực tiếp, payment capture UI hoặc Operator UI.
- Chưa đánh giá đầy đủ keyboard navigation, screen reader, reduced motion và các kích thước viewport khác.

Các kết quả trên chỉ chứng minh những trạng thái đã render và quan sát trong local browser; không dùng để tuyên bố production readiness hoặc full end-to-end acceptance.

## Bổ sung xác minh bằng Browser Harness — 2026-09-25

Một lần kiểm tra local độc lập đã chạy lại trên Chrome headless qua CDP với
viewport quan sát `780 × 437`:

1. Mở landing page và xác nhận title `Gove — Di chuyển rõ ràng`, API badge
   `Hệ thống đang hoạt động`, nội dung tiếng Việt và không có horizontal
   overflow (`scrollWidth = 765`, `innerWidth = 780`).
2. Đăng ký một synthetic Customer bằng form `/register`; UI chuyển sang
   `/sign-in` sau khi API trả `201`.
3. Đăng nhập bằng form; UI chuyển sang `/account`, hiển thị actor Customer và
   lịch sử rỗng đúng trạng thái.
4. Mở `Đặt chuyến` bằng SPA navigation. Form Hanoi, pickup/dropoff marker và
   Leaflet fallback render thành công; không cấu hình MapLibre style URL trong
   lần chạy này nên không ghi nhận MapLibre success path.
5. Bấm `Xem giá ước tính`; UI gọi `/api/v1/pricing/fare-quotes` và hiển thị
   `Xe máy tiêu chuẩn`, khoảng cách `1.9 km`, giá ước tính và thời hạn quote
   khoảng 5 phút.

Lần chạy này bổ sung bằng chứng Customer register → login → account → fare
quote trên runtime hiện tại. Nó không thay thế các gap về Driver approval,
accepted Ride/Delivery, disconnect/reconnect, payment UI, OSRM runtime hoặc
staging public được liệt kê ở trên.
