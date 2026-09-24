# Benchmark Smoke Evidence — 2026-09-24

Trạng thái: Tested locally — smoke workload only

> **Snapshot lịch sử — đã supersede về trạng thái hiện tại (2026-09-25).**
> Bản ghi này chỉ mô tả smoke run ngày 2026-09-24. Khi viết báo cáo, dùng
> evidence ngày 2026-09-25 cho trạng thái hiện tại; bản ghi này chỉ được trích
> dẫn như benchmark smoke lịch sử. Evidence ngày 2026-09-25 chưa tạo một
> benchmark capacity mới, nên không được hiểu là đã có baseline hiệu năng mới.

## Mục tiêu

Kiểm tra `closed-loop` load mode có thể tạo synthetic Customer/Driver, tạo
Fare Quote, tạo Trip và chạy matching bounded mà không làm sai invariant khi
Driver chưa được duyệt.

Đây không phải benchmark năng lực production. Không dùng kết quả này để kết
luận SLA, capacity, route quality hoặc ETA navigation.

## Cấu hình và môi trường

- Commit baseline: working tree, no release commit yet
- Run source: current working tree after the load generator was synchronized
  with the Hanoi service area. Repeat at the final commit before using this as
  release evidence.
- Host: Linux 7.0.0-34-generic, x86_64
- Node: v24.19.0
- npm: 11.17.0
- API URL: `http://127.0.0.1:3000`
- Database: local PostgreSQL/PostGIS Compose service
- Mode: `closed-loop`
- Smoke: `true`
- Warm-up: 0 giây
- Measurement: 1 giây
- Configured concurrency: 1
- Operator token: không cung cấp; synthetic Driver giữ trạng thái pending
- `LOAD_COMPLETE_TRIPS`: default `true`; the run ends at `NO_DRIVER_AVAILABLE`
  because no approved Driver was supplied

## Kết quả đo được

| Chỉ số                                  |   Kết quả |
| --------------------------------------- | --------: |
| Measurement duration                    | 1.02 giây |
| Lifecycle attempts                      |        10 |
| Total requests                          |        30 |
| Requests/sec                            |     29.41 |
| Lifecycle attempts/sec                  |      9.80 |
| Total latency p50                       |  25.28 ms |
| Total latency p95                       |  76.66 ms |
| Total latency p99                       |  87.58 ms |
| HTTP 201 responses                      |        30 |
| Request errors                          |         0 |
| Invariant violations                    |         0 |
| Fare Quote / Trip created               |     10/10 |
| Trip matched/accepted/completed         |     0/0/0 |
| Explicit `NO_DRIVER_AVAILABLE` outcomes |        10 |

Per-stage latency:

- Fare Quote: p50 17.98 ms, p95/p99 69.31 ms
- Trip creation: p50 19.41 ms, p95/p99 40.99 ms
- Matching: p50 49.07 ms, p95/p99 87.58 ms

## Interpretation and limitation

The run proves that the bounded generator, Hanoi service-area validation, Fare
Quote, Trip creation, and no-approved-Driver path are executable and produced
no observed correctness violation. It does not measure
accepted matching, payment, WebSocket propagation, CPU, memory, database
resource utilization, contention, reconnects, or multi-instance behavior.
The full 100-Driver / 20-Customer workload from the completion plan remains a
separate run requiring approved synthetic Drivers and retained resource
metrics.

Reproduce the smoke run with:

```bash
LOAD_MODE=closed-loop \
LOAD_SMOKE=true \
LOAD_COMPLETE_TRIPS=false \
npm run load:api
```
