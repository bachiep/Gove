CREATE SCHEMA IF NOT EXISTS delivery;

CREATE TABLE delivery.deliveries (
  id uuid PRIMARY KEY,
  customer_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  pickup_label text NOT NULL,
  pickup_location geography(Point, 4326) NOT NULL,
  dropoff_label text NOT NULL,
  dropoff_location geography(Point, 4326) NOT NULL,
  recipient_display_name text NOT NULL,
  recipient_contact_phone text NOT NULL,
  parcel_description text NOT NULL,
  declared_weight_grams integer NOT NULL,
  state text NOT NULL DEFAULT 'REQUESTED'
    CHECK (state IN ('REQUESTED', 'MATCHING', 'DRIVER_TO_PICKUP', 'AT_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'NO_DRIVER_AVAILABLE')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_deliveries_labels_not_blank
    CHECK (char_length(btrim(pickup_label)) BETWEEN 1 AND 160 AND char_length(btrim(dropoff_label)) BETWEEN 1 AND 160),
  CONSTRAINT delivery_deliveries_distinct_points
    CHECK (ST_X(pickup_location::geometry) <> ST_X(dropoff_location::geometry) OR ST_Y(pickup_location::geometry) <> ST_Y(dropoff_location::geometry)),
  CONSTRAINT delivery_deliveries_recipient_name_not_blank
    CHECK (char_length(btrim(recipient_display_name)) BETWEEN 1 AND 120),
  CONSTRAINT delivery_deliveries_recipient_phone_not_blank
    CHECK (char_length(btrim(recipient_contact_phone)) BETWEEN 6 AND 32),
  CONSTRAINT delivery_deliveries_parcel_description_not_blank
    CHECK (char_length(btrim(parcel_description)) BETWEEN 1 AND 280),
  CONSTRAINT delivery_deliveries_weight_range
    CHECK (declared_weight_grams BETWEEN 1 AND 30000)
);

CREATE INDEX delivery_deliveries_by_customer_created
  ON delivery.deliveries (customer_user_id, created_at DESC);
CREATE INDEX delivery_deliveries_active_worklist
  ON delivery.deliveries (state, created_at)
  WHERE state IN ('REQUESTED', 'MATCHING', 'DRIVER_TO_PICKUP', 'AT_PICKUP', 'IN_TRANSIT');

CREATE TRIGGER delivery_deliveries_touch_updated_at
BEFORE UPDATE ON delivery.deliveries
FOR EACH ROW EXECUTE FUNCTION public.gove_touch_updated_at();

CREATE TABLE delivery.state_transitions (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES delivery.deliveries(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES identity.users(id) ON DELETE RESTRICT,
  command text NOT NULL,
  from_state text,
  to_state text NOT NULL,
  from_version integer,
  to_version integer NOT NULL CHECK (to_version >= 0),
  reason text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_state_transitions_versions
    CHECK ((from_version IS NULL AND to_version = 0) OR to_version = from_version + 1),
  CONSTRAINT delivery_state_transitions_initial_state
    CHECK ((from_version IS NULL AND from_state IS NULL AND to_state = 'REQUESTED') OR from_version IS NOT NULL),
  CONSTRAINT delivery_state_transitions_unique_version
    UNIQUE (delivery_id, to_version)
);

CREATE TABLE delivery.command_receipts (
  actor_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint bytea NOT NULL,
  response_body jsonb NOT NULL,
  delivery_id uuid REFERENCES delivery.deliveries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, operation, idempotency_key),
  CONSTRAINT delivery_command_receipts_fingerprint_size
    CHECK (octet_length(request_fingerprint) = 32)
);

CREATE TABLE delivery.outbox_events (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES delivery.deliveries(id) ON DELETE RESTRICT,
  aggregate_version integer NOT NULL CHECK (aggregate_version >= 0),
  event_type text NOT NULL,
  payload_version integer NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  CONSTRAINT delivery_outbox_events_unique_event
    UNIQUE (delivery_id, aggregate_version, event_type)
);

CREATE INDEX delivery_outbox_events_unpublished
  ON delivery.outbox_events (occurred_at)
  WHERE published_at IS NULL;
