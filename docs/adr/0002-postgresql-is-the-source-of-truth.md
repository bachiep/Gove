---
status: accepted
---

# PostgreSQL is the source of truth

PostgreSQL with PostGIS owns durable identity, Driver, Trip, dispatch, pricing, and Payment state. Redis may accelerate expiring geo lookups, connection routing, and pub-sub, but all Redis data must be rebuildable or safely degradable because business correctness cannot depend on an ephemeral cache surviving.

## Consequences

Critical transitions use database transactions, constraints, and versions. High-rate telemetry must be bounded and may use Redis before selective persistence, while any behavior that changes money, assignment, or lifecycle state must be committed in PostgreSQL first.
