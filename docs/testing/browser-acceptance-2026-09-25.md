# Browser Acceptance Record — 2026-09-25

Trạng thái: Partial — evidence thực tế đã cập nhật, các gate Driver/OSRM còn
được giữ mở.

## Môi trường

- Browser Harness/CDP trên local Vite host.
- Origin được kiểm tra: `http://localhost:5173`.
- MapLibre local preview được kiểm tra riêng trên `http://localhost:5175` với
  `VITE_MAPLIBRE_STYLE_URL=/assets/gove-map-preview.json` và tab visible.
- Viewport: desktop `1440px` và mobile `375px`.
- Dữ liệu synthetic; không ghi credential, token, cookie hoặc PII vào
  repository.

## Kết quả đã quan sát

| Scenario                      | Kết quả                | Ghi chú                                                                                                                                         |
| ----------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer register/login       | Pass                   | HTTP `201`/`200`; session hoạt động trên origin được phép                                                                                       |
| Fare Quote                    | Pass sau retry         | UI ghi rõ `Tọa độ dự phòng` và `Tuyến ước tính theo tọa độ`                                                                                     |
| Customer tạo Trip             | Pass ở boundary        | Không có Driver khả dụng nên Trip kết thúc ở trạng thái `NO_DRIVER_FOUND`                                                                       |
| Customer current-trip request | Pass                   | `GET /trips/current` trả `200`; không có active Trip để kiểm tra resume                                                                         |
| Driver profile/vehicle        | Pass                   | Profile `200`, Vehicle `201`                                                                                                                    |
| Driver Console                | Pass (local synthetic) | Driver synthetic được approve trong local fixture, online, nhận Offer và hiển thị route/ETA theo tọa độ                                         |
| Ride Driver lifecycle         | Pass (local synthetic) | Nhận Offer → đến điểm đón → bắt đầu → hoàn tất; Customer tab nhận đủ trạng thái realtime                                                        |
| Delivery Driver lifecycle     | Pass (local synthetic) | Nhận Offer → đến điểm lấy → xác nhận nhận kiện → đang giao → xác nhận giao; Customer tab nhận `DELIVERED` và Driver trở về `AVAILABLE`          |
| Payment Simulator             | Pass (local synthetic) | Customer ghi nhận thanh toán mô phỏng sau khi hoàn tất; trạng thái `SUCCEEDED` hiển thị trên UI                                                 |
| MapLibre local renderer       | Pass (local preview)   | Visible browser tab rendered `canvas.maplibregl-canvas` from the local style and worker; no external tile/glyph/sprite request or console error |
| Responsive layout             | Pass                   | Không phát hiện horizontal overflow ở desktop/mobile đã kiểm tra                                                                                |

## Findings và giới hạn

- OSM tile host trả `ERR_CONNECTION_REFUSED` trong phiên kiểm tra. UI không
  chặn form và vẫn giữ coordinate fallback; đây chưa phải bằng chứng tile
  provider hoạt động.
- Origin `127.0.0.1:5173` bị `AUTH_ORIGIN_FORBIDDEN` `403`; `localhost:5173`
  hoạt động. Đây là boundary đã cấu hình, không coi là lỗi authentication.
- Fare Quote lần đầu trả `502`, lần retry sau trả `201`; cần giữ lại dưới dạng
  reliability finding và điều tra nếu tái hiện được.
- Trong phiên kiểm tra đầu, thông báo lỗi Driver eligibility còn tiếng Anh từ
  API; response/UI boundary sau đó đã được Việt hóa theo `error.code`.
- Local synthetic Full Ride Driver lifecycle đã chạy được với một Driver đã được
  approve trong database local và GPS fixture còn fresh. Đây là evidence cho
  lifecycle và realtime status, không phải evidence cho Operator browser UI.
- Nút consent foreground GPS hoạt động, nhưng Browser Harness chưa cấp quyền
  geolocation nên watcher báo đúng trạng thái “chưa cấp quyền vị trí”; chưa
  đánh dấu GPS marker thật là `Verified`.
- Offer hết hạn đúng rule khi chờ quá thời gian; TTL Ride đã được nâng từ 10 lên
  20 giây để UI có thời gian render và nhận Offer, vẫn do server kiểm soát.
- Delivery Driver lifecycle đã được kiểm tra bằng hai tab Customer/Driver với
  một Driver synthetic đã được approve trong local fixture. Đây là bằng chứng
  local cho state transition và UI projection; không phải bằng chứng cho
  Operator approval UI, GPS nền, WebSocket reconnect sau reload hoặc
  road-route runtime.
- MapLibre local renderer đã được kiểm tra trong một tab visible với
  `VITE_MAPLIBRE_STYLE_URL=/assets/gove-map-preview.json`: canvas MapLibre,
  local style và local worker đều được tải; không có request tile/glyph/sprite
  bên ngoài và không có console error. Đây chỉ là bằng chứng renderer/style
  local, không phải vector basemap, road routing hay ETA theo đường thực tế.
- Backend realtime hiện đã có integration test đóng socket Ride, mở một socket
  mới, authenticate lại và nhận authoritative snapshot có Latest Driver
  Location. Đây chưa thay thế browser acceptance cho reconnect sau reload;
  Browser Harness vẫn giữ gate này ở trạng thái mở.

## Artifact ngoài repository

Các screenshot dùng để đối chiếu được giữ ngoài Git:

- `/tmp/gove-home-authenticated-desktop-latest.png`
- `/tmp/gove-home-mobile-latest.png`
- `/tmp/gove-customer-ride-quote-success.png`
- `/tmp/gove-customer-trip-resume-localhost.png`
- `/tmp/gove-driver-console-pending.png`
- `/tmp/gove-driver-console-mobile.png`
- `/home/pac-hip-dz/.config/browser-harness/agent-workspace/recordings/gove-delivery-browser-20260925`
- `/home/pac-hip-dz/.config/browser-harness/agent-workspace/recordings/gove-maplibre-local-preview-20260925.png`

Không coi screenshot là bằng chứng cho các scenario chưa chạy được.
