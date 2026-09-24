# Đánh giá công nghệ bản đồ cho demo Hà Nội

## Quyết định

Gove sẽ không gọi public tile server hoặc public routing server như một hạ tầng
không giới hạn. Mục tiêu demo không phát sinh phí được chia thành các giai đoạn:

1. Giữ bản đồ Leaflet + raster tile hiện có như một fallback có attribution;
   không chặn luồng tạo Ride/Delivery khi tile lỗi.
2. Thử nghiệm **MapLibre GL JS** ở một map adapter tách biệt, trước hết bằng
   source được cấu hình qua environment/runtime configuration. MapLibre là lựa
   chọn renderer open-source cho mục tiêu vector/WebGL, không phải nhà cung cấp
   dữ liệu bản đồ.
3. Thêm OSRM tự host, chỉ với dữ liệu Hà Nội ngoài Git, sau khi đo tài nguyên,
   import dữ liệu và kiểm thử route. OSRM là provider phía backend sau
   `RoutingService`, không được gọi trực tiếp từ PWA.
4. Chỉ cân nhắc OSRM `match` cho một trace GPS đã được giới hạn, có đồng ý về
   quyền riêng tư, và có fallback rõ ràng. Map matching không thay thế Latest
   Location source of truth.
5. Chưa thêm H3 vào MVP. PostGIS hiện đáp ứng candidate generation; H3 chỉ là
   phương án đánh giá sau benchmark khi có bằng chứng PostGIS index/ranking là
   bottleneck.

Không giai đoạn nào được quảng bá là điều hướng production, ETA giao thông thực
tế, hoặc bản đồ có SLA nếu chưa có benchmark và vận hành tương ứng.

## Bằng chứng hiện trạng Gove

| Thành phần            | Bằng chứng hiện có                                                                                                                                                                 | Hệ quả đối với quyết định                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Web client            | React PWA, hiện phụ thuộc `leaflet` và `@types/leaflet`.                                                                                                                           | Di chuyển sang MapLibre là thay đổi UI có chủ đích, không phải thay package để “có map”.                                                    |
| Map hiện tại          | `LiveMapPreview` dùng `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, attribution, marker và dashed coordinate line.                                                         | Đây là **raster tile** và đường xem trước theo tọa độ, không phải vector basemap hay road route.                                            |
| Live location         | WebSocket `/ws` gửi projection `driver.location`; API Location xác thực tọa độ, accuracy, capture time, sequence, speed và heading; giới hạn một update được chấp nhận mỗi 3 giây. | Client có dữ liệu đầu vào để nội suy marker, nhưng chỉ hiển thị sau assignment được ủy quyền và trong cửa sổ freshness hiện có.             |
| State và dữ liệu      | PostgreSQL/PostGIS là durable Latest Driver Location; Dispatch dùng PostGIS distance query.                                                                                        | Renderer, animation, OSRM và H3 không được trở thành source of truth hoặc ghi ngược state business.                                         |
| Routing boundary      | `RoutingService` đã có `RoutingProvider`, timeout, metadata provenance và coordinate fallback có nhãn. Profile hiện chỉ là `DRIVING`.                                              | Có thể thêm OSRM adapter phía backend mà không ghép UI/domain trực tiếp với vendor; fallback phải tiếp tục ghi rõ không phải road route.    |
| Phạm vi demo hiện tại | `PricingService` và pricing integration tests validate synthetic inner-Hanoi bounds `20.98..21.10`, `105.76..105.90`.                                                              | Hà Nội là vùng demo được triển khai trong backend hiện tại; OSRM extract/runtime và browser evidence cho road route vẫn chưa được verified. |

## Kiểm chứng các nhận định trong đề xuất

| Nhận định                                                                                             | Kết luận              | Cơ sở và giới hạn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MapLibre GL JS là renderer vector chạy trong browser bằng WebGL/GPU.                                  | **Đã xác minh**       | MapLibre mô tả GL JS là thư viện TypeScript render map tương tác từ vector tiles và MapLibre Style Specification trong browser bằng WebGL; API/style spec có vector, raster và GeoJSON source. [MapLibre GL JS](https://maplibre.org/projects/gl-js/), [MapLibre sources](https://maplibre.org/maplibre-style-spec/sources/).                                                                                                                                                                           |
| MapLibre cho phép bearing, pitch, control và layer/source động.                                       | **Đã xác minh**       | API có navigation/rotation controls, source/layer API và examples cho vector/GeoJSON. Điều đó cho phép thiết kế camera theo heading nếu UX quyết định dùng nó; không chứng minh rằng nên tự động xoay camera mọi lúc. [Map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/), [MapLibre examples](https://maplibre.org/maplibre-gl-js/docs/examples/).                                                                                                                                    |
| Chỉ cần thay Leaflet bằng MapLibre là có vector map miễn phí.                                         | **Không được hỗ trợ** | MapLibre không cung cấp basemap. Một vector deployment cần style hợp lệ và vector source; style có thể tham chiếu TileJSON/tile URL, và cần các asset mà style yêu cầu như glyph/sprite. Public raster OSM endpoint hiện dùng bởi Gove không tự biến thành vector tile. [MapLibre sources](https://maplibre.org/maplibre-style-spec/sources/), [MapLibre style root](https://maplibre.org/maplibre-style-spec/root/).                                                                                   |
| Vector/WebGL sẽ luôn đạt 60 FPS.                                                                      | **Không được hỗ trợ** | Tài liệu MapLibre nêu GPU acceleration nhưng không là bằng chứng cho FPS trên thiết bị, network, style hay dataset của Gove. FPS, frame time và memory phải được đo trên thiết bị demo trước khi có con số công bố. [MapLibre GL JS](https://maplibre.org/projects/gl-js/).                                                                                                                                                                                                                             |
| Nội suy marker giữa hai GPS updates có thể làm chuyển động trên màn hình liên tục hơn.                | **Đủ điều kiện**      | Đây là kỹ thuật presentation phía client, phù hợp với WebSocket projection hiện có. Nó không tạo vị trí quan sát mới, không được vượt quá timestamp/location được server chấp nhận, và phải dừng/đánh dấu stale khi stream mất. Chưa có benchmark hay implementation trong Gove.                                                                                                                                                                                                                        |
| Dead reckoning giúp xe tiếp tục chạy đúng khi mất sóng.                                               | **Đủ điều kiện**      | Có thể làm UI prediction có nhãn “ước tính”, nhưng không được gửi vị trí suy đoán về backend, dùng để dispatch, hiển thị như vị trí thật, hoặc tiếp tục quá freshness window. Cần policy về sai số, timeout và consent trước khi triển khai.                                                                                                                                                                                                                                                            |
| GPS điện thoại luôn sai số 5–15 m.                                                                    | **Không được hỗ trợ** | Không có nguồn chính thức được khảo sát ở đây chứng minh một khoảng sai số cố định cho mọi thiết bị/bối cảnh. Gove đã nhận `accuracyMeters`; đó là dữ liệu cần dùng khi đánh giá từng update, không thay bằng một hằng số marketing.                                                                                                                                                                                                                                                                    |
| OSRM Match là map matching/snap-to-road.                                                              | **Đã xác minh**       | OSRM mô tả Match service là ghép/snap GPS points vào road network theo cách plausible nhất. Nó nhận timestamps, radiuses/accuracy và có thể trả confidence. [OSRM Match service](https://project-osrm.org/docs/v5.24.0/api/#match-service).                                                                                                                                                                                                                                                             |
| OSRM Match dùng Hidden Markov Model và sẽ luôn bám đúng làn/đúng chiều.                               | **Không được hỗ trợ** | API chính thức được khảo sát không cam kết thuật toán HMM, lane-level correctness hay kết quả hoàn chỉnh. Tài liệu nêu outlier có thể bị loại, trace có thể bị split khi gap lớn hơn 60 giây/chuyển tiếp không hợp lý, và có thể trả `NoMatch`. [OSRM Match service](https://project-osrm.org/docs/v5.24.0/api/#match-service).                                                                                                                                                                         |
| OSRM Route trả tuyến “ngắn nhất”.                                                                     | **Đủ điều kiện**      | Route service được mô tả là tìm **fastest route** theo profile và graph đã chuẩn bị, không phải cam kết “shortest” theo khoảng cách. Kết quả có thể `NoRoute`; profiles được xác định lúc chuẩn bị dữ liệu. [OSRM Route service](https://project-osrm.org/docs/v5.24.0/api/#route-service), [OSRM general options](https://project-osrm.org/docs/v5.24.0/api/#general-options).                                                                                                                         |
| OSRM phù hợp để tạo geometry/distance/duration cho provider adapter.                                  | **Đã xác minh**       | Route API hỗ trợ geometry GeoJSON, distance/duration và profile prepared ahead of time; phù hợp với `RoutingProvider` hiện có sau khi adapter kiểm tra response/provenance. Nó không có traffic feed mặc định trong tài liệu này. [OSRM Route service](https://project-osrm.org/docs/v5.24.0/api/#route-service).                                                                                                                                                                                       |
| Dùng public OpenStreetMap tile “hoàn toàn miễn phí” cho app.                                          | **Không được hỗ trợ** | OSM data là open data, nhưng OSM Foundation nói public tile servers có capacity hữu hạn, best-effort, không SLA và có thể block usage gây hại. Đó không phải hosted map backend miễn phí vô điều kiện. [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/), [OSM copyright and license](https://www.openstreetmap.org/copyright).                                                                                                                                             |
| OSM public tile có thể dùng cho demo traffic thấp.                                                    | **Đủ điều kiện**      | Chỉ khi URL HTTPS đúng, visible attribution, browser Referer, không restrictive referrer policy, cache theo header (ít nhất 7 ngày nếu không đọc được), và không bulk download/prefetch. URL provider phải thay được không cần app update. Điều kiện tương tự áp dụng cho OSM public vector tile endpoint; endpoint vector cũng best-effort và cấm bulk. [Raster policy](https://operations.osmfoundation.org/policies/tiles/), [Vector policy](https://operations.osmfoundation.org/policies/vector/). |
| OSM “chi tiết hơn Google cho xe máy Việt Nam”, GrabMaps/Be strategy hoặc số liệu thị trường được nêu. | **Không được hỗ trợ** | Đây là các so sánh/khẳng định về bên thứ ba không có nguồn primary được cung cấp hay kiểm chứng trong đánh giá này. Không dùng chúng làm evidence học thuật hay chọn architecture.                                                                                                                                                                                                                                                                                                                      |
| H3 là index lưới lục giác phân cấp để tìm Driver.                                                     | **Đã xác minh**       | H3 là discrete global grid, multi-precision hierarchical index, chủ yếu là hexagon nhưng mỗi resolution có 12 pentagon. Nó có thể là một spatial bucketing/indexing tool, không phải routing engine hay transaction/concurrency primitive. [H3 overview](https://h3geo.org/docs/3.x/core-library/overview/).                                                                                                                                                                                            |
| H3 tự làm matching/surge trong microseconds và được toàn ngành dùng.                                  | **Không được hỗ trợ** | Không có benchmark Gove hoặc bằng chứng primary cho ngưỡng microsecond/toàn ngành. H3 không tự giải quyết eligibility, reservation, idempotency, lock ordering hoặc assignment transaction.                                                                                                                                                                                                                                                                                                             |

## Nguồn tile và attribution

Gove hiện dùng đúng dạng raster URL của OSM, nhưng cần kiểm tra đầy đủ các điều
kiện sau trước khi giữ nó trong demo public:

- Attribution phải nhìn thấy trên map, không bị che, tắt hoặc nằm ngoài viewport:
  `© OpenStreetMap contributors`, liên kết đến copyright/license khi phù hợp.
- Không thêm prefetch/offline bulk download hoặc `no-cache` mặc định.
- Không cấu hình `Referrer-Policy` làm browser không gửi Referer đến tile host.
- URL tile, style URL và attribution phải đi qua cấu hình có thể thay đổi khi
  runtime; tile error cần chuyển sang coordinate fallback thay vì làm hỏng Ride.
- Chỉ gọi tile host từ browser với traffic demo thấp; không proxy/đổi
  User-Agent để che danh tính và không coi OSMF endpoint là dependency có SLA.
- Không gửi GPS, Trip ID, User ID, token hoặc dữ liệu cá nhân vào URL/query
  của tile/style/glyph/sprite provider. Tile request chỉ có z/x/y như chính sách
  mô tả.

Nếu demo dùng MapLibre với public OSM vector tile, các điều kiện vector policy
vẫn có hiệu lực. Việc source là vector không loại bỏ attribution, cache,
best-effort hoặc nguy cơ bị chặn. Một vector style tùy chỉnh cũng phải quản lý
nguồn glyph/sprite và license của mọi asset riêng.

## Kiến trúc demo Hà Nội không phát sinh phí provider

```text
Driver device (foreground GPS)
  -> validated Location API / authenticated WebSocket command
  -> PostgreSQL + PostGIS (Latest Location source of truth)
  -> authorized WebSocket projection
  -> PWA map adapter
       ├─ primary: configured MapLibre GL JS map/style/source
       └─ failure fallback: coordinate summary + marker/line state

Ride/Delivery endpoints
  -> RoutingService (backend)
       ├─ primary: local OSRM Hanoi adapter
       └─ fallback: existing coordinate estimate, explicitly labeled
```

### Stage A — truthful baseline

- Service area, fixtures, default camera, demo labels và documentation hiện đã
  được đồng bộ theo vùng Hà Nội; giữ integration test để ngăn map Hà Nội nhưng
  API price reject coordinates Hà Nội.
- Duy trì Leaflet raster map đang chạy cùng visible OSM attribution và fallback
  UI. Không thêm prefetch.
- Đo browser layout/failure state; không tuyên bố FPS, route precision hay ETA
  thực tế.

### Stage B — renderer và marker presentation

- Tạo map renderer abstraction có implementation Leaflet hiện tại và một
  implementation MapLibre GL JS. Chỉ migrate UI sau khi style/source configuration
  được kiểm tra trên browser demo.
- Dùng GeoJSON source cho pickup, dropoff, route geometry và authorized Driver
  projection. Cập nhật source khi nhận event; không tạo websocket riêng từ map.
- Nội suy chỉ nối **hai observed points theo thứ tự sequence/timestamp**. Giới
  hạn animation đến update tiếp theo hoặc freshness deadline; cancel animation
  khi reconnect, sequence gap, location stale, assignment terminal hoặc quyền
  subscription bị thu hồi.
- Tôn trọng `prefers-reduced-motion`, có trạng thái text thay thế và điều khiển
  keyboard/touch không phụ thuộc canvas.

### Stage C — OSRM Hà Nội tự host

- Tải/extract/map data vào volume local ngoài Git và ghi rõ data version,
  profile, ngày cập nhật, checksum và license/attribution. Không commit file
  `.osm.pbf`, graph đã preprocess hoặc tile archive.
- Adapter gọi nội bộ qua `RoutingService` với timeout, cancellation, response
  validation và circuit/fallback behavior đã có. Không expose OSRM trực tiếp
  ra Quick Tunnel và không đưa OSRM endpoint vào browser bundle.
- Với MVP, label là `Tuyến đề xuất` và `ETA ước tính từ routing data`; không
  dùng “shortest”, “real-time traffic” hay “thời gian thực” nếu profile/dataset
  không chứng minh được.
- Chỉ recompute khi domain transition hoặc ngưỡng di chuyển/thời gian được xác
  định và benchmark. Cache phải có TTL, route-input fingerprint và không cache
  chéo tenant/Trip khi chính sách ownership không cho phép.

### Stage D — map matching có kiểm soát

- Gửi batch trace tối thiểu cần thiết vào OSRM `match`, gồm accuracy/radius và
  monotonically increasing timestamps nếu có; giới hạn số point, age và request
  rate.
- Lưu raw GPS theo retention policy hiện hành; matched geometry là derived
  presentation/analytics data, không ghi đè Latest Location, không thay đổi
  dispatch ranking và không quyết định fare ở MVP.
- Khi `NoMatch`, split trace, low confidence hoặc provider timeout, hiển thị
  raw authorized point/stale state theo policy thay vì kéo marker sang một road
  không có bằng chứng.

## Privacy, security và failure constraints

| Rủi ro                                          | Constraint bắt buộc                                                                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lộ vị trí                                       | Chỉ subscription đã được authorize cho assigned Trip/Delivery nhận Driver location. Không gắn GPS/identity vào third-party tile URL, log client, screenshot evidence hoặc analytics không cần thiết. |
| Map provider/tile lỗi                           | Map surface có error state; Ride/Delivery command vẫn dùng coordinates đã nhập. Không retry vô hạn, prefetch hay bypass policy.                                                                      |
| OSRM lỗi/timeout                                | `RoutingService` trả fallback có `usedFallback`/`fallbackReason`; UI không vẽ fallback như road geometry hoặc hiển thị nó là traffic ETA.                                                            |
| GPS outlier/stream gap                          | Validate accuracy, sequence và capture time ở ingress; UI dừng prediction khi stale/gap. Match failure không được tự coi là road truth.                                                              |
| Thiết bị không hỗ trợ WebGL hoặc reduced motion | Renderer capability check và non-canvas coordinate/route summary fallback; không buộc user bật GPU hoặc animation để hoàn thành task.                                                                |
| Quick Tunnel/public demo                        | Quick Tunnel chỉ đưa UI/API/WebSocket demo ra ngoài trong phiên. Không expose OSRM admin/data volume, Postgres, Redis, secrets hoặc callback payment ổn định qua URL tạm.                            |

## Tiêu chí trước khi nâng trạng thái

| Hạng mục           | Bằng chứng tối thiểu                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hanoi service area | API/integration tests dùng tọa độ Hà Nội; UI sample và routing dataset cùng phạm vi.                                                                                                              |
| MapLibre renderer  | Browser evidence cho load, tile/style error fallback, 375px mobile, keyboard, reduced-motion và WebGL-unavailable fallback.                                                                       |
| Live marker        | Browser E2E có Driver được authorize, sequence/freshness, reconnect và assignment revoke; chứng minh không broadcast trước khi acceptance.                                                        |
| OSRM route         | Adapter contract/integration tests gồm normal, `NoRoute`, timeout, bad response và fallback label; provenance/data version hiển thị trong diagnostic evidence.                                    |
| OSRM match         | Test `NoMatch`, split/outlier, privacy/retention và proof derived geometry không ghi đè authoritative location.                                                                                   |
| Performance        | Workload, device/hardware, map style/source, dataset version, duration, p50/p95/p99 frame or request metrics và limitation được ghi lại. Không dùng số liệu vendor/marketing thay benchmark Gove. |
| H3                 | Chỉ có ADR/benchmark so sánh PostGIS hiện tại với H3 candidate generation trên workload Hà Nội; concurrency/assignment tests vẫn pass.                                                            |

## Official sources

- [MapLibre GL JS project overview](https://maplibre.org/projects/gl-js/)
- [MapLibre GL JS API and examples](https://maplibre.org/maplibre-gl-js/docs/)
- [MapLibre Style Specification — Sources](https://maplibre.org/maplibre-style-spec/sources/)
- [MapLibre Style Specification — Root](https://maplibre.org/maplibre-style-spec/root/)
- [OpenStreetMap Foundation raster tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [OpenStreetMap Foundation vector tile usage policy](https://operations.osmfoundation.org/policies/vector/)
- [OpenStreetMap copyright and licence](https://www.openstreetmap.org/copyright)
- [OSRM HTTP API](https://project-osrm.org/docs/v5.24.0/api/)
- [H3 geospatial indexing overview](https://h3geo.org/docs/3.x/core-library/overview/)
