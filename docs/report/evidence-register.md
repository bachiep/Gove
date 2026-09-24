# Sổ Đăng Ký Bằng Chứng Báo Cáo

Trạng thái: Đang cập nhật
Cập nhật lần cuối: 2026-09-25

Đây là checklist traceability cho báo cáo kỹ thuật, không phải nhật ký hoạt
động. Mỗi nhận định trong báo cáo phải truy ngược được tới source code,
migration, test, browser record, benchmark hoặc deployment record tương ứng.
Sổ này cố ý giữ các khoảng trống thay vì biến một thiết kế thành kết quả đã
kiểm chứng.

## Quy tắc về snapshot lịch sử

Các snapshot ngày 2026-09-24 là bằng chứng lịch sử và đã bị evidence ngày
2026-09-25 supersede khi dùng để mô tả trạng thái hiện tại. Khi trích dẫn cho
báo cáo, ưu tiên record 2026-09-25 được liên kết trong register này; không suy
ra trạng thái hiện tại từ `final-evidence-gap-2026-09-24.md` hoặc các browser
record ngày 2026-09-24. Benchmark smoke ngày 2026-09-24 vẫn được giữ như số đo
lịch sử, vì evidence 2026-09-25 chưa cung cấp benchmark capacity mới.

## Quy ước trạng thái

| Trạng thái    | Ý nghĩa                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `Designed`    | Đã có quyết định hoặc contract, chưa chứng minh implementation đầy đủ. |
| `Implemented` | Có code hoặc schema tương ứng; chưa đủ bằng chứng nghiệm thu.          |
| `Tested`      | Có test tự động đã chạy và kết quả được ghi nhận.                      |
| `Verified`    | Đã thỏa đúng loại evidence mà claim yêu cầu và có thể tái lập.         |
| `Deployed`    | Đã kiểm chứng trên một host/môi trường được định danh.                 |
| `Partial`     | Có một phần bằng chứng, nhưng còn gate bắt buộc chưa đóng.             |

## Register hiện tại

| ID     | Nội dung dùng trong báo cáo                             | Nguồn sự thật                                                                                                                                                   | Bằng chứng hiện có                                                                                                                  | Trạng thái    | Bằng chứng còn thiếu                                                                              |
| ------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| RPT-01 | Phạm vi Ride, Delivery và non-goals                     | [`completion-definition.md`](../project/completion-definition.md), requirements                                                                                 | Frozen scope và explicit non-goals đã được ghi rõ                                                                                   | `Designed`    | Review cuối cùng để bảo đảm claim không vượt frozen scope                                         |
| RPT-02 | Kiến trúc modular monolith, ownership và trust boundary | [`diagrams/architecture.md`](diagrams/architecture.md), `docs/architecture`, ADR 0001–0009                                                                      | Sơ đồ và ADR đối chiếu với module hiện có                                                                                           | `Implemented` | Architecture snapshot ở commit phát hành                                                          |
| RPT-03 | Schema, constraint và invariant                         | [`database-reference.md`](database-reference.md), [`diagrams/data-model.md`](diagrams/data-model.md), `infra/postgres/migrations/0001–0014`                     | Release commit `70f377f` replay, 14 migrations, 10 schemas, zero-row invariant queries, and current-baseline restore verification   | `Tested`      | Off-host recovery policy and final report snapshot                                                |
| RPT-04 | REST, WebSocket và outbox contract                      | [`api-and-event-catalog.md`](api-and-event-catalog.md), `docs/api`, `packages/contracts`                                                                        | Catalog và integration/protocol tests hiện có                                                                                       | `Partial`     | Reconcile catalog với OpenAPI/contracts tại final commit                                          |
| RPT-05 | Ride request, dispatch và Trip lifecycle                | `apps/api/src/{pricing,trip,dispatch}`, Trip/Dispatch integration tests                                                                                         | Fare Quote, idempotency, reservation, race, lifecycle tests và Browser Harness Ride lifecycle/payment evidence                      | `Partial`     | Browser reconnect, GPS permission path và cancellation evidence                                   |
| RPT-06 | Delivery aggregate và custody lifecycle                 | `apps/api/src/delivery`, `docs/domain/delivery-lifecycle.md`                                                                                                    | Delivery integration tests, Customer browser create/history/detail, local synthetic Customer/Driver lifecycle đến `DELIVERED`       | `Partial`     | Reconnect, GPS/route runtime và Operator approval boundary                                        |
| RPT-07 | Realtime authority và reconnect                         | `apps/api/src/realtime`, [`sequences.md`](diagrams/sequences.md)                                                                                                | Realtime protocol tests, Ride close/open WebSocket integration test, Location stale-sequence evidence và Customer snapshot evidence | `Partial`     | Browser disconnect/reconnect trong accepted Ride và Delivery                                      |
| RPT-08 | Map, routing provenance và fallback                     | `apps/api/src/routing`, [`map-and-routing.md`](diagrams/map-and-routing.md), `docs/architecture/map-and-eta.md`                                                 | Routing unit tests, Fare Quote route metadata, Leaflet fallback và MapLibre local renderer browser evidence                         | `Partial`     | OSRM runtime, production-quality tile policy, road-route browser evidence và accessibility review |
| RPT-09 | Payment boundary                                        | `apps/api/src/payment`, `docs/payments`, ADR 0008                                                                                                               | `SIMULATOR` outcome/idempotency tests; `MOMO`/`SEPAY` pending baseline test                                                         | `Tested`      | Không cần cho frozen MVP; real provider/webhook chỉ được ghi nếu có sandbox evidence              |
| RPT-10 | Operator diagnostics và onboarding review               | [`operator-and-audit.md`](diagrams/operator-and-audit.md), `docs/api/operator-diagnostics.md`                                                                   | Authorization, validation, PII-minimized audit và onboarding idempotency integration tests                                          | `Tested`      | Browser Operator workflow và pending-review list nếu đưa vào scope                                |
| RPT-11 | Security, privacy và rate limit                         | `docs/security`, source guards/rate limit, integration tests                                                                                                    | Exact browser Origin cho cookie auth, WebSocket origin policy, payload/quota và ownership evidence đã được test local               | `Partial`     | Final secret/history scan, proxy-aware/multi-instance review và diagnostics exposure review       |
| RPT-12 | Performance và capacity                                 | [`benchmark-smoke-2026-09-24.md`](../testing/benchmark-smoke-2026-09-24.md) (historical smoke), [`performance-workload.md`](../testing/performance-workload.md) | Closed-loop no-approved-Driver smoke có p50/p95/p99 và zero observed violations                                                     | `Partial`     | Approved-Driver workload, contention, GPS/WebSocket/reconnect và resource metrics                 |
| RPT-13 | Local deployment, recovery và rollback                  | `docs/operations`, operation scripts                                                                                                                            | Release commit `70f377f`, current-baseline backup/restore, and isolated rollback rehearsal                                          | `Partial`     | Off-host recovery and named staging evidence                                                      |
| RPT-14 | Browser acceptance và responsive UI                     | [`browser-acceptance-2026-09-25.md`](../testing/browser-acceptance-2026-09-25.md), prior browser records                                                        | Customer/Driver Ride lifecycle, Payment Simulator, Customer/Driver Delivery lifecycle, MapLibre local renderer và responsive checks | `Partial`     | Keyboard/reduced-motion/accessibility, reconnect, GPS permission và Operator                      |

Current database evidence: [`migration-replay-2026-09-25.md`](../testing/migration-replay-2026-09-25.md) records release commit `70f377f` replay in `gove_replay_20260925_rc2` through `0014`, zero-row invariant queries, and the current-baseline restore in `gove_restore_20260925_rc1`.

## Checklist chốt một claim

- [ ] Claim được gắn với một requirement hoặc non-goal cụ thể.
- [ ] Source path và test/evidence path đã được ghi rõ.
- [ ] Artifact ghi commit hoặc working-tree boundary, ngày giờ, môi trường và
      command cần thiết để tái lập.
- [ ] Kết quả được phân biệt giữa `Implemented`, `Tested`, `Verified` và
      `Deployed`.
- [ ] Số đo có workload, dataset, duration, concurrency, software/hardware và
      limitation; không suy diễn capacity từ một smoke run.
- [ ] Browser claim có viewport, origin, synthetic-data boundary và scenario;
      screenshot không chứa token, secret, PII hoặc tọa độ đầy đủ.
- [ ] Database claim có migration version và invariant query/output summary;
      không chỉ dẫn một file SQL.
- [ ] Sơ đồ đã render từ Mermaid trong repository và không thêm quan hệ ngoài
      source/evidence.
- [ ] Các khoảng trống còn lại được liên kết với acceptance matrix và known
      limitations.

## Artifact tối thiểu cho mỗi chương

| Chương            | Artifact cần chốt                                          | Không được kết luận nếu thiếu                    |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Phân tích yêu cầu | Charter, requirements, acceptance matrix                   | Phạm vi đã hoàn thành                            |
| Kiến trúc         | ADR, architecture diagram, ownership/failure model         | Production readiness hoặc high availability      |
| Cài đặt           | Source path, contract, migration, focused tests            | Behavior chỉ vì code đã tồn tại                  |
| Kiểm thử          | Test command/result, browser record, benchmark table       | SLA, capacity hoặc full E2E                      |
| Triển khai        | Compose/config, health, migration, rollback/backup record  | `Deployed` nếu chưa có host định danh            |
| Kết quả           | Acceptance matrix, known limitations, final evidence audit | `100%` khi còn mandatory row `Partial`/`Planned` |

## Ranh giới dữ liệu khi đưa vào báo cáo

Chỉ commit bản tóm tắt đã được làm sạch. Raw browser log, token, cookie,
secret, email/số điện thoại thật, tọa độ đầy đủ và dữ liệu cá nhân phải ở ngoài
repository hoặc được loại bỏ trước khi trích dẫn. Tài liệu này không ghi nhận
phân công, hội thoại hay hoạt động của agent.
