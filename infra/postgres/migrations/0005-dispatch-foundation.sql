CREATE SCHEMA IF NOT EXISTS location;
CREATE SCHEMA IF NOT EXISTS dispatch;

CREATE TABLE IF NOT EXISTS location.latest_driver_locations (
  driver_user_id uuid PRIMARY KEY REFERENCES driver.driver_profiles(user_id) ON DELETE RESTRICT,
  location geography(Point, 4326) NOT NULL,
  accuracy_meters numeric(8, 2) NOT NULL,
  speed_meters_per_second numeric(8, 2),
  heading_degrees numeric(6, 2),
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'GPS',
  sequence_number bigint NOT NULL DEFAULT 0,
  CONSTRAINT location_latest_driver_locations_accuracy_range
    CHECK (accuracy_meters BETWEEN 0 AND 10000),
  CONSTRAINT location_latest_driver_locations_speed_range
    CHECK (speed_meters_per_second IS NULL OR speed_meters_per_second BETWEEN 0 AND 100),
  CONSTRAINT location_latest_driver_locations_heading_range
    CHECK (heading_degrees IS NULL OR heading_degrees >= 0 AND heading_degrees < 360),
  CONSTRAINT location_latest_driver_locations_source
    CHECK (source IN ('GPS', 'NETWORK', 'SIMULATOR')),
  CONSTRAINT location_latest_driver_locations_sequence
    CHECK (sequence_number >= 0),
  CONSTRAINT location_latest_driver_locations_timestamp_skew
    CHECK (captured_at <= received_at + INTERVAL '5 minutes'),
  CONSTRAINT location_latest_driver_locations_point_range
    CHECK (
      ST_X(location::geometry) BETWEEN -180 AND 180
      AND ST_Y(location::geometry) BETWEEN -90 AND 90
    )
);

CREATE INDEX IF NOT EXISTS location_latest_driver_locations_geo_lookup
  ON location.latest_driver_locations USING gist (location);

CREATE INDEX IF NOT EXISTS location_latest_driver_locations_freshness_lookup
  ON location.latest_driver_locations (captured_at DESC, driver_user_id);

CREATE TABLE IF NOT EXISTS dispatch.driver_work_states (
  driver_user_id uuid PRIMARY KEY REFERENCES driver.driver_profiles(user_id) ON DELETE RESTRICT,
  work_state text NOT NULL DEFAULT 'OFFLINE',
  current_trip_id uuid REFERENCES trip.trips(id) ON DELETE RESTRICT,
  state_version bigint NOT NULL DEFAULT 0,
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_driver_work_states_value
    CHECK (work_state IN ('OFFLINE', 'AVAILABLE', 'RESERVED', 'TO_PICKUP', 'ON_TRIP')),
  CONSTRAINT dispatch_driver_work_states_version
    CHECK (state_version >= 0),
  CONSTRAINT dispatch_driver_work_states_trip_binding
    CHECK (
      (work_state IN ('OFFLINE', 'AVAILABLE') AND current_trip_id IS NULL)
      OR (work_state IN ('RESERVED', 'TO_PICKUP', 'ON_TRIP') AND current_trip_id IS NOT NULL)
    ),
  CONSTRAINT dispatch_driver_work_states_timestamp_order
    CHECK (state_changed_at <= updated_at)
);

CREATE INDEX IF NOT EXISTS dispatch_driver_work_states_candidate_lookup
  ON dispatch.driver_work_states (work_state, driver_user_id)
  WHERE work_state = 'AVAILABLE';

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_driver_work_states_one_trip_per_driver
  ON dispatch.driver_work_states (current_trip_id)
  WHERE current_trip_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'dispatch.driver_work_states'::regclass
      AND tgname = 'dispatch_driver_work_states_touch_updated_at'
  ) THEN
    CREATE TRIGGER dispatch_driver_work_states_touch_updated_at
    BEFORE UPDATE ON dispatch.driver_work_states
    FOR EACH ROW EXECUTE FUNCTION public.gove_touch_updated_at();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS dispatch.driver_reservations (
  id uuid PRIMARY KEY,
  driver_user_id uuid NOT NULL REFERENCES driver.driver_profiles(user_id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL REFERENCES trip.trips(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution_reason text,
  resolved_by_user_id uuid REFERENCES identity.users(id) ON DELETE RESTRICT,
  CONSTRAINT dispatch_driver_reservations_identity
    UNIQUE (id, trip_id, driver_user_id),
  CONSTRAINT dispatch_driver_reservations_status
    CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  CONSTRAINT dispatch_driver_reservations_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT dispatch_driver_reservations_resolution_after_creation
    CHECK (resolved_at IS NULL OR resolved_at >= created_at),
  CONSTRAINT dispatch_driver_reservations_terminal_metadata
    CHECK (
      (
        status = 'ACTIVE'
        AND resolved_at IS NULL
        AND resolution_reason IS NULL
        AND resolved_by_user_id IS NULL
      )
      OR (
        status <> 'ACTIVE'
        AND resolved_at IS NOT NULL
        AND char_length(btrim(resolution_reason)) BETWEEN 1 AND 240
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_driver_reservations_one_active_driver
  ON dispatch.driver_reservations (driver_user_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_driver_reservations_one_active_trip
  ON dispatch.driver_reservations (trip_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS dispatch_driver_reservations_expiry_worklist
  ON dispatch.driver_reservations (expires_at, driver_user_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS dispatch.trip_offers (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trip.trips(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL,
  driver_user_id uuid NOT NULL REFERENCES driver.driver_profiles(user_id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution_reason text,
  resolved_by_user_id uuid REFERENCES identity.users(id) ON DELETE RESTRICT,
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES identity.users(id) ON DELETE RESTRICT,
  acceptance_idempotency_key text,
  acceptance_correlation_id text,
  accepted_trip_version integer,
  CONSTRAINT dispatch_trip_offers_reservation_identity
    FOREIGN KEY (reservation_id, trip_id, driver_user_id)
    REFERENCES dispatch.driver_reservations (id, trip_id, driver_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT dispatch_trip_offers_one_offer_per_reservation
    UNIQUE (reservation_id),
  CONSTRAINT dispatch_trip_offers_attempt_number
    CHECK (attempt_number > 0),
  CONSTRAINT dispatch_trip_offers_status
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED')),
  CONSTRAINT dispatch_trip_offers_expiry_after_offer
    CHECK (expires_at > offered_at),
  CONSTRAINT dispatch_trip_offers_resolution_after_offer
    CHECK (resolved_at IS NULL OR resolved_at >= offered_at),
  CONSTRAINT dispatch_trip_offers_acceptance_before_expiry
    CHECK (status <> 'ACCEPTED' OR resolved_at < expires_at),
  CONSTRAINT dispatch_trip_offers_acceptance_key_format
    CHECK (
      acceptance_idempotency_key IS NULL
      OR char_length(acceptance_idempotency_key) BETWEEN 8 AND 128
    ),
  CONSTRAINT dispatch_trip_offers_acceptance_correlation_format
    CHECK (
      acceptance_correlation_id IS NULL
      OR char_length(btrim(acceptance_correlation_id)) BETWEEN 1 AND 128
    ),
  CONSTRAINT dispatch_trip_offers_accepted_version
    CHECK (accepted_trip_version IS NULL OR accepted_trip_version >= 0),
  CONSTRAINT dispatch_trip_offers_terminal_metadata
    CHECK (
      (
        status = 'PENDING'
        AND resolved_at IS NULL
        AND resolution_reason IS NULL
        AND resolved_by_user_id IS NULL
        AND accepted_at IS NULL
        AND accepted_by_user_id IS NULL
        AND acceptance_idempotency_key IS NULL
        AND acceptance_correlation_id IS NULL
        AND accepted_trip_version IS NULL
      )
      OR (
        status = 'ACCEPTED'
        AND resolved_at IS NOT NULL
        AND resolved_by_user_id IS NOT NULL
        AND resolution_reason IS NULL
        AND accepted_at = resolved_at
        AND accepted_by_user_id = resolved_by_user_id
        AND acceptance_idempotency_key IS NOT NULL
        AND acceptance_correlation_id IS NOT NULL
        AND accepted_trip_version IS NOT NULL
      )
      OR (
        status = 'REJECTED'
        AND resolved_at IS NOT NULL
        AND resolved_by_user_id IS NOT NULL
        AND char_length(btrim(resolution_reason)) BETWEEN 1 AND 240
        AND accepted_at IS NULL
        AND accepted_by_user_id IS NULL
        AND acceptance_idempotency_key IS NULL
        AND acceptance_correlation_id IS NULL
        AND accepted_trip_version IS NULL
      )
      OR (
        status IN ('EXPIRED', 'REVOKED')
        AND resolved_at IS NOT NULL
        AND char_length(btrim(resolution_reason)) BETWEEN 1 AND 240
        AND accepted_at IS NULL
        AND accepted_by_user_id IS NULL
        AND acceptance_idempotency_key IS NULL
        AND acceptance_correlation_id IS NULL
        AND accepted_trip_version IS NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_trip_offers_one_pending_trip
  ON dispatch.trip_offers (trip_id)
  WHERE status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_trip_offers_one_pending_driver
  ON dispatch.trip_offers (driver_user_id)
  WHERE status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_trip_offers_attempt_per_trip
  ON dispatch.trip_offers (trip_id, attempt_number);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_trip_offers_acceptance_key_per_driver
  ON dispatch.trip_offers (accepted_by_user_id, acceptance_idempotency_key)
  WHERE status = 'ACCEPTED';

CREATE INDEX IF NOT EXISTS dispatch_trip_offers_expiry_worklist
  ON dispatch.trip_offers (expires_at, trip_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS dispatch_trip_offers_driver_history
  ON dispatch.trip_offers (driver_user_id, offered_at DESC);
