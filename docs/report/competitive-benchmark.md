# Đánh giá khách quan so với Grab

Status: Evidence-based product comparison
Last updated: 2026-09-25

Tài liệu này không tuyên bố Gove ngang bằng Grab. Grab là một nền tảng thương
mại đã vận hành ở quy mô lớn; Gove hiện là một hệ thống học thuật/demo có
vertical slice Ride + Delivery và các ranh giới kỹ thuật có thể kiểm chứng.
Mục tiêu là học đúng những trải nghiệm ảnh hưởng trực tiếp đến người dùng,
đồng thời giữ nét riêng của Gove thay vì sao chép một super app.

## Kết luận ngắn

Gove hiện chưa thể cạnh tranh với Grab ở product breadth, road navigation,
driver supply, trust & safety, support, payment thật, nationwide operations,
hay production-scale reliability. Đây là kết luận bắt buộc để tránh dùng các
từ như `production-ready` khi chưa có evidence.

Gove có lợi thế riêng ở tính minh bạch kỹ thuật: state machine rõ ràng,
PostgreSQL là source of truth, idempotency/concurrency được thiết kế và test,
payment boundary có `SIMULATOR`, map/routing có fallback có provenance, và mọi
claim được phân loại Planned/Implemented/Tested/Verified/Deployed.

## Ma trận hiện trạng

| Capability                    | Grab — public product evidence                                                                                                                            | Gove hiện tại                                                                                                                                                         | Đánh giá                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Ride + Delivery surface       | Grab công bố các nhóm Transport, Delivery và Logistics; điều khoản nêu GrabBike, GrabTaxi, GrabCar và GrabExpress.                                        | Có Ride và Delivery aggregate riêng, một parcel với Pickup/Dropoff, bounded custody/proof.                                                                            | Gove đủ cho MVP/demo, chưa đủ breadth của commercial platform.                     |
| Map, address, road route, ETA | Trải nghiệm thương mại yêu cầu map/address/route/ETA đáng tin cậy trong booking và on-trip flow.                                                          | Có MapLibre staged renderer, Leaflet fallback, coordinate preview và RoutingProvider seam; geocoding, road route, traffic ETA và Driver route guidance chưa verified. | Khoảng cách P0 cho parity trải nghiệm.                                             |
| Payment                       | Grab công bố cashless payment qua Moca wallet và stored cards; điều khoản hỗ trợ cash/cashless methods.                                                   | `SIMULATOR` có deterministic settlement; `MOMO`/`SEPAY` mới là provider baseline tạo `PENDING`, chưa có QR/webhook/reconciliation.                                    | Đúng scope academic hiện tại; payment thật là workstream có credential/risk riêng. |
| Safety and support            | Grab công bố 24/7 Safety Centre, emergency assistance, incident reporting và chia sẻ chuyến; Grab cũng mô tả các biện pháp safety trước/trong/sau chuyến. | Có auth, ownership, audit/rate-limit foundations; chưa có SOS, in-app support, rating/feedback, KYC/MFA và retained browser evidence cho safety.                      | Khoảng cách P0 nếu mở public; không cần giả vờ đã có trong demo.                   |
| Dispatch and realtime         | Commercial platform cần continuous matching, supply management, reconnect/fan-out và vận hành đa instance.                                                | Có bounded reservation/offer/expiry, outbox, authenticated WebSocket, stale-location rules; process-local fan-out/rate limits và multi-instance chưa verified.        | Đủ để chứng minh correctness slice, chưa production parity.                        |
| Operations                    | Grab công bố vận hành Transport/Delivery nationwide trong điều khoản và có support/incident processes.                                                    | Local Compose đã test; VPS/Cloudflare/PhoneGrid staging, TLS/WSS, rollback external và resource benchmark chưa verified.                                              | Đây là boundary môi trường, không được gọi là production.                          |

## Điều đáng học và thứ cần giữ

### Nên học từ Grab

1. Booking phải giảm số quyết định của người dùng: service type, pickup,
   destination, fare/ETA, Driver identity và trạng thái phải nhìn thấy trong
   một luồng liên tục.
2. Map phải hữu ích chứ không chỉ là ảnh nền: address search, road geometry,
   ETA, stale/reconnect state và hướng dẫn recovery phải rõ ràng.
3. Trust signals cần xuất hiện đúng lúc: Driver/vehicle identity, share trip,
   safety entry point, support và post-trip feedback.
4. Payment status phải giải thích được: pending, succeeded, failed,
   retry/reconciliation; không được để người dùng đoán tiền đã đi đâu.
5. Empty/loading/error states phải có hành động tiếp theo; không hiển thị
   một màn hình đẹp nhưng không giúp người dùng hoàn thành nhiệm vụ.

### Nét riêng của Gove cần giữ

- Vietnamese-first UI với technical identifiers/API/SQL giữ bằng English để
  báo cáo và vận hành chính xác.
- Một vertical slice nhỏ nhưng chạy được từ Customer → Trip/Delivery →
  Dispatch → Realtime → Completion/Simulator Payment.
- Explainable architecture: PostgreSQL/PostGIS là durable source of truth,
  Redis không bị dùng như authoritative state, và fallback luôn ghi rõ
  provenance.
- Academic defensibility: invariant, state transition, idempotency,
  concurrency, failure behavior và evidence được viết cùng implementation.
- Vendor-neutral seams cho MapLibre/Leaflet, OSRM/fallback và payment provider,
  phù hợp ngân sách zero-cost của demo.

## Parity roadmap không over-engineer

### Trước khi gọi Ride/Delivery demo là hoàn thiện

- Browser acceptance toàn bộ Customer và Driver happy path, gồm accepted
  Driver, realtime status, marker freshness và reconnect.
- Map fallback phải rõ ràng; nếu OSRM không sẵn sàng, UI phải nói rõ đây là
  coordinate estimate. Không tuyên bố shortest route/traffic ETA.
- Hoàn thiện loading/empty/error/retry copy và accessibility cho các form chính.
- Giữ `SIMULATOR` làm mặc định; chỉ thêm QR/webhook provider khi có credential,
  signature verification, idempotency, replay protection và reconciliation test.

### Sau demo, nếu có quyền và rủi ro được chấp thuận

- Geocoding + road routing/ETA có provider policy, quota, cache và fallback.
- Foreground Driver GPS flow và Customer live marker với stale/reconnect UI.
- Continuous dispatch/reassignment, multi-instance realtime và durable worker
  checkpoint.
- Safety/support/rating và Driver onboarding evidence.
- Named staging environment qua PhoneGrid/Cloudflare với TLS/WSS, backup,
  rollback và benchmark resource profile.

Không nằm trong mục tiêu 100% hiện tại: xây super app ngang Grab, nationwide
driver network, loyalty ecosystem, food/merchant marketplace, hay tự tuyên bố
production scale khi chưa có traffic và operations evidence.

## Public references

- [Grab Vietnam](https://www.grab.com/vn/)
- [Grab VN — Trust and Safety](https://www.grab.com/vn/en/about/trust-and-safety/)
- [Grab VN — Platform and Ride Safety](https://www.grab.com/vn/en/sustainability/platform/safety/)
- [Grab VN — Transport, Delivery and Logistics terms](https://www.grab.com/vn/en/terms-policies/transport-delivery-logistics/)
- [Grab VN — Cashless payment](https://www.grab.com/vn/en/pay/)
