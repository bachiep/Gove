CREATE TABLE pricing.service_types (
  code text PRIMARY KEY,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_service_types_code_format
    CHECK (code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT pricing_service_types_display_name_not_blank
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100)
);

CREATE TABLE pricing.rate_card_versions (
  id uuid PRIMARY KEY,
  service_type_code text NOT NULL REFERENCES pricing.service_types(code) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  base_fare_minor bigint NOT NULL CHECK (base_fare_minor >= 0),
  distance_rate_minor_per_kilometer bigint NOT NULL CHECK (distance_rate_minor_per_kilometer >= 0),
  duration_rate_minor_per_minute bigint NOT NULL CHECK (duration_rate_minor_per_minute >= 0),
  service_multiplier_bps integer NOT NULL CHECK (service_multiplier_bps > 0),
  minimum_surge_multiplier_bps integer NOT NULL CHECK (minimum_surge_multiplier_bps > 0),
  maximum_surge_multiplier_bps integer NOT NULL CHECK (maximum_surge_multiplier_bps > 0),
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_rate_card_versions_surge_bounds
    CHECK (minimum_surge_multiplier_bps <= maximum_surge_multiplier_bps),
  CONSTRAINT pricing_rate_card_versions_unique_version
    UNIQUE (service_type_code, version),
  CONSTRAINT pricing_rate_card_versions_unique_effective_from
    UNIQUE (service_type_code, effective_from)
);

CREATE TABLE pricing.fare_quotes (
  id uuid PRIMARY KEY,
  customer_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  service_type_code text NOT NULL REFERENCES pricing.service_types(code) ON DELETE RESTRICT,
  rate_card_version_id uuid NOT NULL REFERENCES pricing.rate_card_versions(id) ON DELETE RESTRICT,
  pickup_label text NOT NULL,
  pickup_location geography(Point, 4326) NOT NULL,
  dropoff_label text NOT NULL,
  dropoff_location geography(Point, 4326) NOT NULL,
  estimated_distance_meters integer NOT NULL CHECK (estimated_distance_meters > 0),
  estimated_duration_seconds integer NOT NULL CHECK (estimated_duration_seconds > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  base_fare_minor bigint NOT NULL CHECK (base_fare_minor >= 0),
  distance_fare_minor bigint NOT NULL CHECK (distance_fare_minor >= 0),
  duration_fare_minor bigint NOT NULL CHECK (duration_fare_minor >= 0),
  service_multiplier_bps integer NOT NULL CHECK (service_multiplier_bps > 0),
  service_adjusted_fare_minor bigint NOT NULL CHECK (service_adjusted_fare_minor >= 0),
  applied_surge_multiplier_bps integer NOT NULL CHECK (applied_surge_multiplier_bps > 0),
  total_fare_minor bigint NOT NULL CHECK (total_fare_minor >= 0),
  rule_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED', 'INVALIDATED')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_fare_quotes_labels_not_blank
    CHECK (char_length(btrim(pickup_label)) BETWEEN 1 AND 160 AND char_length(btrim(dropoff_label)) BETWEEN 1 AND 160),
  CONSTRAINT pricing_fare_quotes_distinct_points
    CHECK (ST_X(pickup_location::geometry) <> ST_X(dropoff_location::geometry) OR ST_Y(pickup_location::geometry) <> ST_Y(dropoff_location::geometry)),
  CONSTRAINT pricing_fare_quotes_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT pricing_fare_quotes_consumption_metadata
    CHECK ((status = 'CONSUMED' AND consumed_at IS NOT NULL) OR (status <> 'CONSUMED' AND consumed_at IS NULL))
);

CREATE INDEX pricing_fare_quotes_active_by_customer
  ON pricing.fare_quotes (customer_user_id, expires_at DESC)
  WHERE status = 'ACTIVE';

CREATE TABLE pricing.command_receipts (
  actor_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint bytea NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, operation, idempotency_key),
  CONSTRAINT pricing_command_receipts_fingerprint_size
    CHECK (octet_length(request_fingerprint) = 32)
);

CREATE TABLE trip.trips (
  id uuid PRIMARY KEY,
  customer_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  fare_quote_id uuid NOT NULL UNIQUE REFERENCES pricing.fare_quotes(id) ON DELETE RESTRICT,
  service_type_code text NOT NULL REFERENCES pricing.service_types(code) ON DELETE RESTRICT,
  pickup_label text NOT NULL,
  pickup_location geography(Point, 4326) NOT NULL,
  dropoff_label text NOT NULL,
  dropoff_location geography(Point, 4326) NOT NULL,
  quote_snapshot jsonb NOT NULL,
  quoted_total_fare_minor bigint NOT NULL CHECK (quoted_total_fare_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  state text NOT NULL DEFAULT 'REQUESTED'
    CHECK (state IN ('REQUESTED', 'MATCHING', 'DRIVER_TO_PICKUP', 'AT_PICKUP', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_DRIVER_AVAILABLE')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_trips_labels_not_blank
    CHECK (char_length(btrim(pickup_label)) BETWEEN 1 AND 160 AND char_length(btrim(dropoff_label)) BETWEEN 1 AND 160)
);

CREATE INDEX trip_trips_by_customer_created
  ON trip.trips (customer_user_id, created_at DESC);
CREATE INDEX trip_trips_active_worklist
  ON trip.trips (state, created_at)
  WHERE state IN ('REQUESTED', 'MATCHING', 'DRIVER_TO_PICKUP', 'AT_PICKUP', 'IN_PROGRESS');

CREATE TRIGGER trip_trips_touch_updated_at
BEFORE UPDATE ON trip.trips
FOR EACH ROW EXECUTE FUNCTION public.gove_touch_updated_at();

CREATE TABLE trip.state_transitions (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trip.trips(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES identity.users(id) ON DELETE RESTRICT,
  command text NOT NULL,
  from_state text,
  to_state text NOT NULL,
  from_version integer,
  to_version integer NOT NULL CHECK (to_version >= 0),
  reason text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_state_transitions_versions
    CHECK ((from_version IS NULL AND to_version = 0) OR to_version = from_version + 1),
  CONSTRAINT trip_state_transitions_initial_state
    CHECK ((from_version IS NULL AND from_state IS NULL AND to_state = 'REQUESTED') OR from_version IS NOT NULL),
  CONSTRAINT trip_state_transitions_unique_version
    UNIQUE (trip_id, to_version)
);

CREATE TABLE trip.command_receipts (
  actor_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint bytea NOT NULL,
  response_body jsonb NOT NULL,
  trip_id uuid REFERENCES trip.trips(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, operation, idempotency_key),
  CONSTRAINT trip_command_receipts_fingerprint_size
    CHECK (octet_length(request_fingerprint) = 32)
);

CREATE TABLE trip.outbox_events (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trip.trips(id) ON DELETE RESTRICT,
  aggregate_version integer NOT NULL CHECK (aggregate_version >= 0),
  event_type text NOT NULL,
  payload_version integer NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  CONSTRAINT trip_outbox_events_unique_event
    UNIQUE (trip_id, aggregate_version, event_type)
);

CREATE INDEX trip_outbox_events_unpublished
  ON trip.outbox_events (occurred_at)
  WHERE published_at IS NULL;

INSERT INTO pricing.service_types (code, display_name)
VALUES
  ('MOTORBIKE_STANDARD', 'Standard motorbike'),
  ('CAR_STANDARD', 'Standard car')
ON CONFLICT (code) DO UPDATE
SET display_name = EXCLUDED.display_name;

INSERT INTO pricing.rate_card_versions (
  id, service_type_code, version, currency, base_fare_minor,
  distance_rate_minor_per_kilometer, duration_rate_minor_per_minute,
  service_multiplier_bps, minimum_surge_multiplier_bps, maximum_surge_multiplier_bps,
  effective_from
)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'MOTORBIKE_STANDARD', 1, 'VND', 12000, 6800, 350, 10000, 10000, 15000, '2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000002', 'CAR_STANDARD', 1, 'VND', 18000, 9500, 550, 10000, 10000, 15000, '2026-01-01T00:00:00Z')
ON CONFLICT (service_type_code, version) DO NOTHING;
