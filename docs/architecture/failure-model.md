# Failure Model

Status: Designed
Last updated: 2026-09-24

| Failure                            | Required behavior                                                                                                 | Recovery evidence                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| PostgreSQL unavailable             | Reject dependent commands with retryable service error; never emit success or durable event                       | Dependency test and readiness failure |
| Redis unavailable                  | Fall back to bounded PostGIS lookup where safe or pause the affected live feature; durable state remains readable | Resilience test and cache rebuild     |
| WebSocket disconnect               | Mark UI reconnecting; fetch authoritative REST snapshot; resume only newer events                                 | Browser E2E reconnect scenario        |
| Stale Driver location              | Exclude Driver from candidate set; show stale status; require a fresh accepted update                             | Freshness integration test            |
| Offer expires during acceptance    | One transaction chooses expiry or acceptance; loser receives conflict, not success                                | Clock-controlled race test            |
| Customer cancels during acceptance | One serializable outcome wins; the other command observes terminal/conflicting state                              | Repeated concurrency test             |
| Duplicate command                  | Return original persisted result for the same actor, operation, and idempotency key                               | Integration test                      |
| Outbox publisher stops             | Business transaction remains committed; pending events retry with bounded backoff and observable age              | Restart and replay test               |
| Payment provider timeout           | Persist `UNKNOWN`; query/reconcile before retrying capture                                                        | Simulator fault test                  |
| Application restarts               | No in-memory value is required to reconstruct active Trips, reservations, or payments                             | Restart E2E test                      |
| Client clock is wrong              | Server time governs expiry and transitions; client countdown is informational                                     | Skewed-clock UI/API test              |

Retries are bounded, jittered where appropriate, and limited to idempotent operations. User-visible failures include a stable error code and correlation ID without exposing internals.
