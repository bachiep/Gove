# Vertical Slice 01 — Request to Simulated Settlement

Status: Accepted
Last updated: 2026-09-24

## Objective

Prove the architecture through one executable Customer-to-Driver ride flow rather than implementing every module horizontally.

## Delivery sequence

1. **Foundation**: npm workspaces, strict TypeScript, NestJS API, React/Vite PWA, shared contracts, Vitest, lint/format/typecheck, CI, Docker Compose, PostgreSQL/PostGIS, migrations, liveness/readiness.
2. **Identity and demo actors**: registration/login, role guards, ownership policy, Customer/Driver profiles, Vehicle eligibility, synthetic seeds.
3. **Trip and pricing core**: deterministic Fare Quote, idempotent Trip creation, lifecycle module, transition audit, OpenAPI contract.
4. **Location and dispatch**: validated Latest Location, fresh PostGIS candidate query, ranking, exclusive Driver Reservation, sequential Trip Offer, expiry/rejection/no-driver behavior.
5. **Acceptance transaction**: atomically accept one offer, assign one Driver, move Driver to `ON_TRIP`, increment Trip version, and write outbox events.
6. **Real-time projection**: authenticated WebSocket subscriptions, semantic Trip events, throttled assigned-Driver location, reconnect snapshot, stale-data UI.
7. **Completion and settlement**: arrival/start/complete commands, final Fare, simulator Payment Attempt, history and receipt.
8. **Verification**: race suites, E2E browser flow, fault tests, security checks, benchmark, deploy/restore/rollback rehearsal.

## Interface baseline

- HTTP prefix: `/api/v1`.
- Health: `/health/live` and `/health/ready`.
- OpenAPI: generated from the running API and checked for compatibility.
- WebSocket path: `/realtime`; authenticated before subscription.
- Mutating retryable commands require `Idempotency-Key`.
- Errors expose stable `code`, safe `message`, `correlationId`, and field details where applicable.

## Rollback

- Each commit remains buildable and migration-compatible with the previous application image.
- Schema changes use expand-and-contract; destructive cleanup waits until the previous image is no longer a rollback target.
- Failed feature rollout disables the new route or handler and redeploys the previous immutable image.
- Data restoration is a separate, rehearsed operation into a clean database; it is not the default application rollback.

## Acceptance evidence

- Fresh clone to healthy local stack using documented commands.
- OpenAPI and migration checks pass.
- Customer and Driver complete the flow in isolated browser sessions.
- Required concurrency, reconnect, ownership, duplicate, and dependency-failure scenarios pass.
- Logs and metrics explain why matching succeeded or failed without exposing secrets or unnecessary location data.
- Documentation status is updated from Designed to the evidence-supported state only.
