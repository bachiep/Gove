# Bằng Chứng Browser Acceptance — 2026-09-24

Trạng thái: Tested locally

> **Snapshot lịch sử — đã supersede (2026-09-25).** Bản ghi ngày 2026-09-24
> không còn là nguồn mô tả trạng thái browser hiện tại. Khi viết báo cáo, ưu
> tiên [Browser Acceptance Record ngày 2026-09-25](browser-acceptance-2026-09-25.md);
> tài liệu này chỉ giữ bằng chứng lịch sử cho phạm vi Customer Delivery hẹp
> hơn.

Ngày kiểm thử: 2026-09-24
Phạm vi: Customer Delivery PWA trên local runtime, dùng synthetic account và
synthetic parcel data.

## Môi trường và cách kiểm thử

- Web PWA: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3000`
- Browser: Chrome được điều khiển qua CDP Browser Harness.
- Dữ liệu: Customer và recipient giả; không sử dụng dữ liệu cá nhân thực.

## Kết quả đã quan sát

| Scenario                                                            | Kết quả                                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Customer đăng ký/đăng nhập rồi mở `Send a parcel`                   | Pass                                                                                         |
| Tạo một Delivery với Pickup, Dropoff, Recipient và Parcel           | Pass                                                                                         |
| Matching không có Driver hợp lệ hiển thị `NO_DRIVER_AVAILABLE`      | Pass                                                                                         |
| Mở Delivery history và Delivery detail của Customer sở hữu Delivery | Pass                                                                                         |
| Responsive check tại viewport 375 px                                | Pass: `viewport`, `documentWidth`, và `bodyWidth` đều là `375`; không có horizontal overflow |

## Diễn giải phạm vi

Kết quả này xác nhận luồng Customer tạo Delivery, authoritative status,
history/detail và layout nhỏ trong browser thực. `delivery.snapshot` và
`delivery.event` đã có integration coverage ở API và PWA đã subscribe theo
`deliveryId`, nhưng run này chưa quan sát trên browser một Driver accept rồi
đi hết `DRIVER_TO_PICKUP` → `AT_PICKUP` → `IN_TRANSIT` → `DELIVERED`.

Vì vậy, bằng chứng này không được dùng để tuyên bố full Delivery browser
acceptance. Scenario Customer-and-Driver custody lifecycle vẫn là gate còn lại
trong [acceptance matrix](../project/acceptance-matrix.md).
