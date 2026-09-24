# Demo and Final Acceptance Runbook

Status: Designed
Last updated: 2026-09-24

This runbook produces repeatable academic demonstration evidence. Use only
synthetic identities and coordinates. Record the commit SHA, environment,
commands, outcomes, and accepted limitations; do not commit credentials, raw
tokens, personal data, or session logs.

## 1. Preflight

1. Confirm the working tree and record the commit under test.
2. Confirm Node.js, npm, Docker, Compose, and available host resources.
3. Create an ignored environment file from safe placeholders with unique local
   secrets.
4. Confirm no PostgreSQL or API port is publicly bound.

Pass condition: the tested commit and environment are identifiable and no
secret or real user data is in the repository.

## 2. Clean verification

From a clean checkout:

```bash
npm ci
docker compose up -d --wait postgres
npm run db:migrate
npm run check
```

Pass condition: migrations, formatting, lint, type checking, automated tests,
and production builds all exit successfully.

## 3. Ride scenario

1. Register isolated Customer and Driver accounts.
2. Complete Driver profile and Vehicle setup.
3. Send a fresh Driver location and go online.
4. Customer obtains a Fare Quote and creates one Trip idempotently.
5. Match, accept, arrive, start, complete, and capture simulated payment.
6. Confirm Customer and Driver status/history agree.
7. Disconnect one browser during the active Trip, reconnect, fetch the
   authoritative snapshot, and confirm newer events continue correctly.

Pass condition: one lifecycle reaches its terminal state, duplicate commands
produce one business effect, and each actor can access only owned data.

## 4. Delivery scenario

1. Customer creates one parcel Delivery with synthetic recipient data.
2. An eligible Driver receives and accepts its offer.
3. Driver records arrival, custody confirmation, and bounded recipient proof.
4. Customer observes authoritative and live state through `DELIVERED` and sees
   the Delivery in history.
5. Confirm recipient contact data is absent from privacy-safe projections.

Pass condition: custody ordering cannot be skipped, proof is required, replay
is idempotent, and Customer/Driver ownership boundaries hold.

## 5. Contention and failure demonstrations

Run the automated repeated race suite and retain a concise sanitized summary:

- two Trips contend for one Driver;
- one Driver is targeted by a Trip and Delivery concurrently;
- acceptance races expiry;
- duplicate payment and Delivery completion commands race;
- stale or out-of-order GPS cannot replace Latest Location;
- reconnect rebuilds from durable HTTP state;
- database unavailability does not return false success.

Pass condition: database invariant queries find no duplicate active Driver
work, invalid aggregate transition, or duplicate settlement effect.

## 6. Performance and operations

1. Run the representative workload from the testing strategy.
2. Record percentiles, throughput, errors, resources, dataset, duration,
   versions, network, and limitations.
3. Start `compose.staging.yaml`, confirm migration-job success, and check live
   and ready endpoints through the PWA proxy.
4. Run the browser Ride and Delivery smoke flow against staging.
5. Back up and restore into a clean database.
6. Redeploy the previous known-good application image without reversing or
   deleting the database volume, then restore the final image.

Pass condition: all procedures are repeatable and no result is presented as a
production-capacity claim.

## 7. Browser and accessibility matrix

Exercise 375, 768, 1024, and 1440 CSS-pixel widths. Complete one core Customer
flow with keyboard only, test denied location permission and manual recovery,
enable reduced motion for one pass, and review console, network, focus,
labels, live regions, and contrast.

Pass condition: no unresolved failure blocks a core action; any accepted minor
finding is recorded with impact and scope.

## 8. Final review

1. Update the acceptance matrix with exact evidence.
2. Review risk, technical debt, open questions, API contracts, architecture,
   deployment status, benchmark limits, and README claims.
3. Confirm no critical/high security issue remains.
4. Mark only actually observed states as Tested, Verified, or Deployed.

The project is 100% complete only when the completion definition's M8 decision
is satisfied. Without a supplied VPS/domain, report `Verified locally` and keep
the external deployment gate explicitly conditional.
