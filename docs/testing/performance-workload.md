# Closed-Loop Performance Workload

Status: Implemented tool; measured results are run-specific

The representative workload is implemented in
[`tools/load/api-load.mjs`](../../tools/load/api-load.mjs). It preserves the
existing `health` and `location` modes and adds `LOAD_MODE=closed-loop`.

## Workload boundary

Each synthetic worker provisions a Customer and Driver, creates the Driver
profile and Vehicle, and then exercises this application path:

```text
register/login
  → Driver onboarding (optional Operator approval)
  → Driver location + availability
  → Fare Quote
  → Trip
  → Matching
  → Offer Acceptance (when a mapped Driver is available)
  → Arrive / Start / Complete
```

Account setup is reported separately from warm-up and the measured phase. A
run without `LOAD_OPERATOR_TOKEN` or approved `LOAD_DRIVER_TOKENS` is still
useful for measuring the no-driver branch, but it cannot prove acceptance.

## Reproducible procedure

1. Start the local API and its documented database dependencies.
2. Run the dry configuration check:

   ```bash
   LOAD_MODE=closed-loop LOAD_DRY_RUN=true npm run load:api
   ```

3. Run the one-second smoke check with one worker:

   ```bash
   LOAD_MODE=closed-loop LOAD_SMOKE=true \
   LOAD_OPERATOR_TOKEN="$GOVE_OPERATOR_ACCESS_TOKEN" \
   npm run load:api
   ```

4. Only after smoke succeeds, run a bounded measurement and save sanitized
   output outside Git.
5. Record the exact commit SHA, API/database versions, machine, Docker
   resources, dataset/setup, network path, warm-up, duration, concurrency,
   interval, timeout, and any supplied Driver/Operator setup.

## Evidence template

Do not fill these fields from an unexecuted plan. Copy values from the command
output and environment used for the run.

| Field                            | Value |
| -------------------------------- | ----- |
| Run timestamp                    |       |
| Commit SHA                       |       |
| Base URL                         |       |
| API/database version             |       |
| Host/container resources         |       |
| Warm-up / duration               |       |
| Concurrency / interval           |       |
| Lifecycle attempts               |       |
| Completed / accepted / no driver |       |
| Request p50 / p95 / p99          |       |
| Request throughput               |       |
| Lifecycle throughput             |       |
| Status and error counts          |       |
| Correctness/invariant result     |       |

The tool deliberately reports a limitation stating that the result is a
bounded local workload. A benchmark report must retain that limitation and must
not turn these measurements into production-capacity or SLA claims.
