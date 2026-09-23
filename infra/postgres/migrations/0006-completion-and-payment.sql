CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE trip.trips
  ADD COLUMN applied_surge_multiplier_bps integer,
  ADD COLUMN actual_distance_meters integer,
  ADD COLUMN actual_duration_seconds integer,
  ADD COLUMN final_fare_minor bigint,
  ADD COLUMN completed_at timestamptz;

UPDATE trip.trips t
SET applied_surge_multiplier_bps = q.applied_surge_multiplier_bps
FROM pricing.fare_quotes q
WHERE q.id = t.fare_quote_id;

ALTER TABLE trip.trips
  ALTER COLUMN applied_surge_multiplier_bps SET NOT NULL,
  ADD CONSTRAINT trip_trips_applied_surge_positive
    CHECK (applied_surge_multiplier_bps > 0),
  ADD CONSTRAINT trip_trips_actual_distance_positive
    CHECK (actual_distance_meters IS NULL OR actual_distance_meters > 0),
  ADD CONSTRAINT trip_trips_actual_duration_positive
    CHECK (actual_duration_seconds IS NULL OR actual_duration_seconds > 0),
  ADD CONSTRAINT trip_trips_final_fare_non_negative
    CHECK (final_fare_minor IS NULL OR final_fare_minor >= 0),
  ADD CONSTRAINT trip_trips_completion_metadata
    CHECK (
      (state = 'COMPLETED'
        AND actual_distance_meters IS NOT NULL
        AND actual_duration_seconds IS NOT NULL
        AND final_fare_minor IS NOT NULL
        AND completed_at IS NOT NULL)
      OR (state <> 'COMPLETED'
        AND actual_distance_meters IS NULL
        AND actual_duration_seconds IS NULL
        AND final_fare_minor IS NULL
        AND completed_at IS NULL)
    );

CREATE TABLE dispatch.assignments (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL UNIQUE REFERENCES trip.trips(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL UNIQUE REFERENCES dispatch.trip_offers(id) ON DELETE RESTRICT,
  driver_user_id uuid NOT NULL REFERENCES driver.driver_profiles(user_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  CONSTRAINT dispatch_assignments_status
    CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED', 'RELEASED')),
  CONSTRAINT dispatch_assignments_timestamps
    CHECK (
      (started_at IS NULL OR started_at >= accepted_at)
      AND (completed_at IS NULL OR completed_at >= accepted_at)
      AND (released_at IS NULL OR released_at >= accepted_at)
    ),
  CONSTRAINT dispatch_assignments_terminal_fields
    CHECK (
      (status = 'ACTIVE' AND completed_at IS NULL AND released_at IS NULL AND release_reason IS NULL)
      OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND released_at IS NULL AND release_reason IS NULL)
      OR (status IN ('CANCELLED', 'RELEASED') AND released_at IS NOT NULL AND char_length(btrim(release_reason)) BETWEEN 1 AND 240)
    )
);

CREATE UNIQUE INDEX dispatch_assignments_one_active_driver
  ON dispatch.assignments (driver_user_id)
  WHERE status = 'ACTIVE';

CREATE INDEX dispatch_assignments_driver_history
  ON dispatch.assignments (driver_user_id, accepted_at DESC);

INSERT INTO dispatch.assignments (
  id, trip_id, offer_id, driver_user_id, status, accepted_at
)
SELECT
  gen_random_uuid(), o.trip_id, o.id, o.driver_user_id, 'ACTIVE', o.accepted_at
FROM dispatch.trip_offers o
WHERE o.status = 'ACCEPTED'
ON CONFLICT (trip_id) DO NOTHING;

CREATE TABLE payment.payment_attempts (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trip.trips(id) ON DELETE RESTRICT,
  customer_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL,
  provider_reference text,
  failure_code text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT payment_attempts_status
    CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  CONSTRAINT payment_attempts_attempt_number
    CHECK (attempt_number > 0),
  CONSTRAINT payment_attempts_resolution
    CHECK (
      (status = 'PENDING' AND resolved_at IS NULL)
      OR (status <> 'PENDING' AND resolved_at IS NOT NULL)
    ),
  CONSTRAINT payment_attempts_provider_fields
    CHECK (
      (status = 'SUCCEEDED' AND provider_reference IS NOT NULL AND failure_code IS NULL)
      OR (status IN ('PENDING', 'FAILED', 'UNKNOWN') AND provider_reference IS NULL)
    ),
  CONSTRAINT payment_attempts_failure_fields
    CHECK (
      (status IN ('FAILED', 'UNKNOWN') AND failure_code IS NOT NULL)
      OR (status IN ('PENDING', 'SUCCEEDED') AND failure_code IS NULL)
    ),
  CONSTRAINT payment_attempts_unique_number
    UNIQUE (trip_id, attempt_number)
);

CREATE UNIQUE INDEX payment_attempts_one_open_or_success
  ON payment.payment_attempts (trip_id)
  WHERE status IN ('PENDING', 'SUCCEEDED', 'UNKNOWN');

CREATE INDEX payment_attempts_by_customer
  ON payment.payment_attempts (customer_user_id, requested_at DESC);

CREATE TABLE payment.command_receipts (
  actor_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint bytea NOT NULL,
  response_body jsonb NOT NULL,
  payment_attempt_id uuid NOT NULL REFERENCES payment.payment_attempts(id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL REFERENCES trip.trips(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, operation, idempotency_key),
  CONSTRAINT payment_command_receipts_fingerprint_size
    CHECK (octet_length(request_fingerprint) = 32)
);

CREATE TABLE payment.outbox_events (
  id uuid PRIMARY KEY,
  payment_attempt_id uuid NOT NULL REFERENCES payment.payment_attempts(id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL REFERENCES trip.trips(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  payload_version integer NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  CONSTRAINT payment_outbox_events_unique_event
    UNIQUE (payment_attempt_id, event_type)
);

CREATE INDEX payment_outbox_events_unpublished
  ON payment.outbox_events (occurred_at)
  WHERE published_at IS NULL;
