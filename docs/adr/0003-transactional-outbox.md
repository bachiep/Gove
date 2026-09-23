---
status: accepted
---

# Publish durable events through a transactional outbox

When a business transaction must trigger asynchronous work, the owning module writes an immutable event envelope to an outbox in the same PostgreSQL transaction. A retryable publisher dispatches it to in-process handlers first and to a broker only after service extraction, preventing the dual-write gap between committed state and emitted events.

## Consequences

Consumers must be idempotent, outbox age and failures must be observable, and cleanup requires a retention policy. This adds database work but avoids introducing a broker as a correctness dependency during the MVP.
