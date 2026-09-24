# Completion Definition

Status: Accepted
Last updated: 2026-09-24

This document defines what `100%` means for the academic Gove project. It is a
scope and evidence boundary, not a claim that Gove has the feature set or
operational maturity of a commercial marketplace.

## Completion claim

Gove is 100% complete when the frozen Ride MVP and first parcel Delivery slice
are implemented, their mandatory acceptance scenarios pass, a clean checkout
can be built and run reproducibly, and every final claim is backed by retained
evidence in the acceptance matrix.

The strongest claim available without an external host is **Verified locally**.
The project may claim **Deployed to demo/staging** only after a named host has
been deployed and health, TLS/WSS, network exposure, browser smoke, backup, and
rollback evidence has been recorded.

## Frozen product scope

### Ride

- Customer and Driver registration, authentication, session rotation, role
  checks, and resource ownership.
- Driver profile, Vehicle eligibility, foreground Latest Location, and work
  state.
- Fare Quote, idempotent Trip creation, geospatial candidate selection,
  exclusive reservation, offer acceptance/rejection/expiry, and no-driver
  outcome.
- Versioned Trip lifecycle from request through completion, including the
  documented cancellation behavior.
- Customer and assigned Driver authoritative snapshots plus authenticated live
  semantic updates and reconnect recovery.
- Final Fare and idempotent payment simulation; no real money movement.
- Customer and Driver terminal history.

### Delivery

- One Customer, one Pickup, one Dropoff, one Recipient, and one Parcel
  manifest.
- A Delivery aggregate independent from Trip, with idempotent creation,
  exclusive Driver reservation, offer acceptance/expiry, custody confirmation,
  recipient proof, and terminal history.
- One shared Driver work-state invariant prevents simultaneous active Trip and
  Delivery work.
- Customer PWA can create and follow its Delivery; Driver Console can accept
  and complete the custody lifecycle.
- Authoritative HTTP projection plus rebuildable live Delivery status.

### Engineering evidence

- Formatting, lint, type checking, automated tests, and production builds pass
  from a clean checkout.
- Migrations succeed against an empty PostgreSQL/PostGIS database.
- Mandatory ownership, idempotency, lifecycle, stale-location, reconnect, and
  concurrency scenarios pass.
- Browser acceptance covers Customer and Driver Ride and Delivery paths at the
  required viewports, including keyboard and reduced-motion checks.
- A representative benchmark records p50, p95, p99, throughput, categorized
  errors, resource use, dataset, versions, and limitations.
- Compose startup, readiness, backup/restore, and application rollback are
  rehearsed without deleting the database volume.
- Security and public-port review finds no unresolved critical or high issue in
  the frozen scope.
- Documentation, contracts, source behavior, and evidence agree.

## Explicit non-goals

The completion percentage does not include real payment providers, card data,
native mobile applications, reliable background GPS, road-network routing,
traffic-aware ETA, multi-stop or food delivery, cash collection, proof photos
or signatures, promotions, ratings, production high availability, Kubernetes,
or independent microservices.

These capabilities may be proposed later, but they cannot silently expand the
accepted completion scope.

## Gate rules

1. Code present but not exercised is **Implemented**, not complete.
2. An automated test pass is **Tested**, not browser or operational proof.
3. Local Compose evidence is not VPS deployment evidence.
4. A benchmark applies only to its recorded workload and environment.
5. A deferred item is acceptable only when it appears in the technical debt or
   known-limitations record and does not violate an accepted requirement.
6. Every row marked `Verified` in the acceptance matrix must name reproducible
   evidence.
7. Any failed mandatory scenario reopens its owning milestone.

## Final decision

M8 exits when all mandatory rows in the acceptance matrix are `Verified`, the
demo runbook passes at a named commit, and remaining limitations are truthful
non-goals or accepted debt. VPS deployment remains a separate environment gate
when infrastructure is unavailable.
