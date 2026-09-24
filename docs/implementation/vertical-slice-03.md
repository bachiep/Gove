# Vertical Slice 03 — Dispatch, Reservation, and Driver Acceptance

Status: Partially implemented and tested locally
Last updated: 2026-09-24

## Objective

Move a valid customer Trip from `REQUESTED` through dispatch to either an accepted
Driver assignment or `NO_DRIVER_AVAILABLE`. This slice defines the correctness
boundary for candidate selection, exclusive Driver reservation, Trip Offer expiry,
and the acceptance race. The current implementation covers only the subset named
in Local evidence; it makes no latency, throughput, matching-quality, or
production-readiness claim.

## Baseline and ownership

Vertical Slice 02 creates a durable Trip in `REQUESTED` state from a consumed Fare
Quote and writes `trip.created` to the Trip outbox. The M3 design builds on that
record; it does not let Dispatch create a second Trip or recalculate the fare.

| Concern                                                             | Owner                   | M3 rule                                                                                              |
| ------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Trip state, version, transition history                             | Trip                    | The only owner of `REQUESTED`, `MATCHING`, `DRIVER_TO_PICKUP`, and `NO_DRIVER_AVAILABLE` transitions |
| Dispatch Request, Driver Work State, Reservation, Offer, Assignment | Dispatch                | Owns candidate attempts and exclusive driver contention                                              |
| Driver/Vehicle eligibility                                          | Driver                  | Supplies an eligibility result; Dispatch does not rewrite Driver profile tables                      |
| Latest Location and freshness                                       | Location                | Supplies a location projection; Dispatch rechecks the freshness rule before reserving                |
| Durable state and transaction boundary                              | PostgreSQL              | Source of truth for assignment correctness; Redis is not an authority                                |
| Asynchronous notification of committed outcomes                     | Producing module outbox | State change and its event are committed together                                                    |

The application remains a modular monolith. A transaction coordinator may invoke
Trip, Dispatch, Driver, and Location interfaces inside one PostgreSQL transaction,
but a module must not write another module's tables directly.

## Designed MVP lifecycle

The following is the proposed command and state sequence. It is a design, not
verified implementation evidence.

The current implementation verifies the start-matching, reservation, pending
offer, acceptance, rejection/reassignment, expiry worker, expiry repair, and
no-fresh-driver portions locally. The remaining steps below stay designed until
asynchronous consumption and the broader retry policy are implemented.

1. **Start dispatch** — An idempotent handler consumes `trip.created`, creates one
   Dispatch Request for the Trip, and asks the Trip module to transition
   `REQUESTED → MATCHING`. Replayed outbox delivery must not create a second
   Dispatch Request or restart a terminal request.
2. **Generate candidates** — Location returns a bounded nearby projection. Dispatch
   filters it by service type, Driver eligibility, `AVAILABLE` work state, fresh
   location, and absence of an active Reservation or Assignment.
3. **Rank candidates** — Dispatch orders the remaining candidates using the
   deterministic ranking policy below. A stale read is only a candidate hint; the
   reservation transaction revalidates the current Driver state.
4. **Reserve and offer** — In one PostgreSQL transaction, Dispatch locks and
   revalidates the selected Driver, creates an `ACTIVE` Driver Reservation, changes
   Driver Work State to `RESERVED`, and creates one `PENDING` Trip Offer with the
   same expiry deadline. The transaction writes the corresponding outbox event.
5. **Await one outcome** — The Driver may accept or reject the pending offer. A
   timeout worker may expire it. Reject and expiry release the Reservation and let
   Dispatch try the next candidate under the search policy.
6. **Commit acceptance** — A valid accept command atomically changes the Offer to
   `ACCEPTED`, changes the Reservation to `COMMITTED`, creates an `ACTIVE`
   Assignment, moves Driver Work State to `TO_PICKUP`, and asks Trip to transition
   `MATCHING → DRIVER_TO_PICKUP`. The same transaction writes assignment and Trip
   events.
7. **Exhaust the policy** — If no candidate can be reserved, all offers are rejected
   or expired, or the search deadline/attempt limit is reached, Dispatch asks Trip
   to transition `MATCHING → NO_DRIVER_AVAILABLE`. No Reservation or pending Offer
   may remain active at that point.

The default MVP strategy is **one active offer at a time per Trip**. Parallel
offers, auctions, and batch assignment are excluded because they multiply
contention and customer-facing ambiguity before the single-offer invariant is
verified.

## Configurable dispatch policy

These are proposed configuration keys and starting defaults for a local/demo
environment. They are policy choices, not performance claims, and must be
validated with controlled integration tests before being described as suitable for
another workload.

| Configuration                         | Proposed default | Rule                                                                                                                                   |
| ------------------------------------- | ---------------: | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DISPATCH_LOCATION_FRESHNESS_SECONDS` |     `15` seconds | A Driver is eligible only when the latest accepted location has a server-recognized `received_at` within this window.                  |
| `DISPATCH_OFFER_TTL_SECONDS`          |     `20` seconds | The Offer and its Reservation share one absolute expiry deadline; this leaves enough time for the Driver Console to render and accept. |
| `DISPATCH_MAX_OFFER_ATTEMPTS`         |              `3` | Maximum sequential candidate offers before the request is exhausted.                                                                   |
| `DISPATCH_SEARCH_DEADLINE_SECONDS`    |     `30` seconds | Hard deadline for the initial matching attempt, measured using the database transaction clock.                                         |
| `DISPATCH_SEARCH_RADIUS_METERS`       |    `5000` meters | Initial candidate-generation radius around pickup; it is not a route-distance promise.                                                 |
| `DISPATCH_MAX_CANDIDATES`             |             `20` | Upper bound on a candidate batch returned to the ranking step.                                                                         |

Freshness is a safety and eligibility rule, not a statement that GPS is delivered
every 15 seconds or that matching completes within any latency target. The rule
uses server `received_at` for freshness so an incorrect Driver device clock cannot
make old telemetry appear live. Client `captured_at` remains useful for monotonic
ordering and plausibility checks; a future or implausibly old timestamp is rejected
or flagged according to the Location policy.

Offer expiry and Reservation expiry are checked against a consistent database
clock inside the transaction that decides acceptance, rejection, or expiry. A
worker is allowed to process an overdue record late; it must still persist the
expired outcome rather than treating the worker's schedule as the source of time.
An expiry is a versioned `MATCHING → MATCHING` transition: it records the
resolved Offer, releases the reservation, advances the Trip version, and only
then creates a replacement Offer. This prevents two sequential expiry attempts
from colliding in the Trip transactional outbox.

## Candidate generation and ranking

Candidate generation is intentionally narrower than “nearest Driver.” The initial
query may use PostGIS or a Location-owned equivalent to find Drivers within the
configured radius, but the result is only a rebuildable projection. Dispatch must
revalidate each candidate before reserving it.

Eligibility filters, in order:

1. the Driver is authenticated and has an approved profile and selected vehicle;
2. the vehicle supports the Trip service type;
3. Driver Work State is `AVAILABLE`;
4. the latest location satisfies the configured freshness rule and coordinate
   validation;
5. the Driver has no active Reservation or Assignment;
6. the Driver is inside the configured search radius and any configured service
   area.

The MVP ranking tuple is deterministic:

```text
(straight_line_distance_to_pickup ASC,
 available_since ASC,
 driver_id ASC)
```

Straight-line distance is a candidate-ranking signal only. It is not a route,
arrival-time, or ETA calculation. `available_since` provides a stable fairness tie
breaker, and `driver_id` makes equal inputs reproducible. Demand balancing, surge
optimization, driver preference, traffic, road-network routing, and machine
learning ranking are outside this slice.

## Reservation and Offer boundary

Reservation and Offer are separate Dispatch concepts:

- A **Driver Reservation** is the exclusive hold that prevents another Trip from
  selecting the same Driver during an active offer.
- A **Trip Offer** is the Driver-facing decision record containing the Trip,
  Driver, Reservation, status, creation time, expiry time, and outcome metadata.
- An **Assignment** is the durable accepted relationship between a Trip and Driver;
  it is created only after acceptance and is not interchangeable with a pending
  Reservation.

The proposed states follow the domain model:

```text
Reservation: ACTIVE → COMMITTED | RELEASED | EXPIRED
Offer:       PENDING → ACCEPTED | REJECTED | EXPIRED | REVOKED
Assignment:  ACTIVE → RELEASED | CANCELLED | COMPLETED
```

The Reservation and Offer use the same absolute `expires_at`. A non-accepted Offer
must release or expire its Reservation in the same transaction. PostgreSQL
constraints should enforce at most one active Reservation per Driver, at most one
pending Offer per Trip, and at most one active Assignment per Trip and Driver.

Redis may accelerate candidate lookup or deliver a notification, but it cannot
reserve a Driver, accept an Offer, authorize a Trip transition, or be the only
copy of an Assignment.

## Acceptance race behavior

Acceptance, expiry, rejection, Trip cancellation before acceptance, and competing
reservations are concurrent commands. The decisive operation is one PostgreSQL
transaction that locks the relevant current rows, rechecks status/version/expiry,
applies all state changes, and appends outbox records. A Redis check followed by a
database update is not sufficient.

The transaction must produce these outcomes:

| Race                                              | Winner                                                                          | Loser/result                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Two Trips choose one Driver                       | First successful Reservation transaction                                        | The other candidate reservation conflicts and the Trip tries its next candidate                              |
| Driver accepts while timeout worker expires Offer | The transaction that first observes a still-valid `PENDING` Offer               | The other receives a conflict such as `OFFER_EXPIRED` or `OFFER_NOT_PENDING`; it cannot create an Assignment |
| Driver sends duplicate accept                     | First accept creates the Assignment                                             | A matching idempotent retry returns the stored acceptance result; no second Assignment is created            |
| Driver rejects while another accept is in flight  | One transaction changes `PENDING` to its terminal outcome                       | The other sees the terminal Offer state and performs no partial release or assignment                        |
| Customer/Operator cancellation before acceptance  | Cancellation transaction revokes the pending Offer and releases its Reservation | A later accept is rejected because the Trip is no longer acceptable                                          |
| Dispatch retry after committed acceptance         | Existing Dispatch Request/command receipt is replayed                           | No new offer or Assignment is created; the committed Trip snapshot remains authoritative                     |

The implementation should use a stable lock order for the records it touches and
retry only a bounded set of transient serialization/deadlock failures. Every
mutating command needs an idempotency key or durable command receipt. The Trip
version is incremented by the Trip transition, and live projections must carry the
resulting version so clients can discard older or duplicate updates.

## Outbox events

The following event names are proposed for this slice; their schemas and versioning
must be finalized before implementation:

| Event                      | Produced after                        | Consumers/use                                           |
| -------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `trip.matching.started`    | Trip enters `MATCHING`                | Dispatch retry/observability                            |
| `trip.offer.created`       | Reservation and pending Offer commit  | Notification and Driver offer projection                |
| `trip.offer.rejected`      | Driver rejection commits              | Dispatch retry                                          |
| `trip.offer.expired`       | Expiry commits                        | Dispatch retry and observability                        |
| `trip.driver.assigned`     | Assignment and Trip acceptance commit | Customer/Driver projections and later realtime delivery |
| `trip.no_driver_available` | Search policy is exhausted            | Customer projection and operations                      |

Every event carries an event ID, Trip ID, aggregate version where applicable,
correlation ID, occurred-at timestamp, and payload version. The producing module
writes the event in the same PostgreSQL transaction as its state change. Delivery
is at-least-once; consumers must be idempotent. A broker is not an MVP correctness
dependency.

## Explicit exclusions

This slice does not yet implement or verify:

- an asynchronous outbox consumer, REST completion, or a full Driver-facing
  Offer UI;
- maps, geocoding, road-network routing, traffic, or customer/Driver ETA;
- background Driver location tracking, location history retention, or GPS spoofing
  detection beyond the Location interface assumptions;
- parallel offers, auction/ML ranking, surge changes, demand forecasting, or
  cross-city/multi-stop dispatch;
- payment, wallet settlement, delivery/logistics workflow, or recipient handling;
- pickup arrival, trip start, completion, full post-acceptance cancellation, or the
  complete reassignment policy;
- Redis locks, Kafka/RabbitMQ, independent service deployment, or high-availability
  claims;
- capacity, latency, throughput, matching-quality, or production-scale claims.

## Remaining acceptance criteria

The design becomes implementation-ready when the following are demonstrated in
tests and recorded as evidence:

- one `REQUESTED` Trip creates one idempotent Dispatch Request and enters `MATCHING`;
- stale, ineligible, incompatible, or already-reserved Drivers are excluded;
- ranking is deterministic for equal input data;
- two concurrent Trips cannot reserve the same Driver;
- Offer and Reservation expiry release the Driver exactly once;
- concurrent accept/expire/reject produces one terminal Offer outcome and at most
  one Assignment;
- accepted state changes and outbox events commit together, while a failed
  transaction leaves Trip, Offer, Reservation, Assignment, and Driver Work State
  unchanged;
- retries and duplicate outbox delivery do not create duplicate Requests, Offers,
  Assignments, or Trip transitions;
- exhausting the configured policy reaches `NO_DRIVER_AVAILABLE` with no active
  Reservation or pending Offer;
- the configured freshness, TTL, radius, attempt, and deadline rules are tested
  with controlled clocks and are not reported as performance measurements.

## Local evidence

- Migration `0005-dispatch-foundation.sql` applies and re-runs successfully.
- Ranking unit tests cover deterministic ordering, stale/ineligible filtering,
  validation, and non-mutation of the input list.
- HTTP integration tests cover location ingestion, eligibility-gated availability,
  persisted matching replay, one-offer creation, concurrent acceptance, accepted
  Driver Work State, overdue Offer release, repeated expiry/reassignment outbox
  records, and stale-location no-driver result.
- Asynchronous outbox consumption and a full Driver-facing Offer UI remain
  planned. Operator approval/rejection is now implemented and covered by the
  Operator integration seam; pending-review listing and browser evidence remain
  open. Customer Trip status and the realtime gateway are delivered in Vertical
  Slice 04.

## Verification status

**Designed:** lifecycle, ownership boundary, candidate filters/ranking, configurable
freshness rule, Reservation/Offer TTL relationship, acceptance race outcomes,
PostgreSQL transaction boundary, outbox intent, and exclusions.

**Implemented and tested locally:** migration constraints, PostGIS candidate query,
deterministic ranking, start-matching idempotency, concurrent acceptance,
rejection/reassignment, bounded expiry sweep, expiry repair, and stale-location
exclusion.

**Not yet verified:** controlled-clock behavior, asynchronous outbox idempotency,
failure recovery, full Driver-facing browser behavior, and any performance or
production-readiness claim.
