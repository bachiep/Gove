# API Load Generator

This tool produces a repeatable local workload and prints measured request
counts, status classes, and p50/p95/p99/max latency. It does not claim service
capacity. Record the machine, commit SHA, API configuration, database state,
network path, and Docker resource usage beside any benchmark report.

All modes default to `http://127.0.0.1:3000`. A non-local URL is refused unless
`LOAD_ALLOW_EXTERNAL_URL=true` is explicitly set. The tool keeps generated
passwords and access tokens in memory and never reads or writes a secret file.
Concurrency and duration are bounded in the tool so an accidental command does
not become an unbounded workload.

All synthetic `location`, `pickup`, and `dropoff` payloads use fixed Hanoi demo
coordinates inside the current service-area box (`20.98–21.10` latitude,
`105.76–105.90` longitude). They represent repeatable test data, not live GPS
signals or route-accuracy evidence.

## Health baseline

```bash
LOAD_BASE_URL=http://127.0.0.1:3000 \
LOAD_MODE=health \
LOAD_CONCURRENCY=8 \
LOAD_DURATION_SECONDS=15 \
npm run load:api
```

## Driver location workload

Provide short-lived Driver access tokens through the environment; do not put
tokens in a file or commit them.

```bash
LOAD_MODE=location \
LOAD_AUTH_TOKENS="token-one,token-two" \
LOAD_CONCURRENCY=2 \
LOAD_DURATION_SECONDS=30 \
LOAD_INTERVAL_MS=3000 \
npm run load:api
```

Location mode sends synthetic coordinates to the authenticated Driver location
endpoint and keeps a monotonic sequence per supplied token. It measures API
ingestion only; it is not a GPS accuracy, WebSocket propagation, matching
capacity, or production-scale result.

## Closed-loop ride workload

`closed-loop` registers and logs in synthetic Customer and Driver accounts,
creates a Driver profile and Vehicle, then repeatedly performs:

```text
Fare Quote → Trip → Matching → Offer Acceptance → Arrive → Start → Complete
```

The Driver must be approved before it can go online. Provide a short-lived
Operator access token through the environment when the run must exercise
acceptance; the tool calls the public Operator endpoints and does not modify the
database directly. Alternatively, `LOAD_DRIVER_TOKENS` can contain existing
approved Driver access tokens. Without either option, the run still measures
Customer → Trip → Matching and reports `NO_DRIVER_AVAILABLE` explicitly.

First validate configuration without contacting any service:

```bash
LOAD_MODE=closed-loop \
LOAD_DRY_RUN=true \
npm run load:api
```

Run a one-worker, one-second smoke workload against a local API:

```bash
LOAD_MODE=closed-loop \
LOAD_SMOKE=true \
LOAD_OPERATOR_TOKEN="$GOVE_OPERATOR_ACCESS_TOKEN" \
npm run load:api
```

Run a bounded local measurement after the smoke run succeeds:

```bash
LOAD_MODE=closed-loop \
LOAD_WARMUP_SECONDS=5 \
LOAD_DURATION_SECONDS=30 \
LOAD_CONCURRENCY=2 \
LOAD_INTERVAL_MS=100 \
LOAD_OPERATOR_TOKEN="$GOVE_OPERATOR_ACCESS_TOKEN" \
npm run load:api
```

The JSON separates setup, warm-up, and measured workload. The measured section
contains request latency percentiles, status/error counts, per-stage summaries,
request and lifecycle throughput, and a correctness summary (`attempts`,
`matched`, `accepted`, `completed`, `noDriverAvailable`, failed attempts, and
invariant violations). `LOAD_COMPLETE_TRIPS=false` stops after acceptance when
assignment-only behavior is the subject of a run.

These results describe only the configured bounded workload. They are not
production capacity, SLA, route-quality, or geographic accuracy claims. Do not
commit shell history, tokens, raw output containing credentials, or unsanitized
benchmark artifacts.
