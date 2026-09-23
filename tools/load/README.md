# API Load Generator

This tool produces a repeatable local workload and prints measured request
counts, status classes, and p50/p95/p99/max latency. It does not claim service
capacity. Record the machine, commit SHA, API configuration, database state,
network path, and Docker resource usage beside any benchmark report.

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
