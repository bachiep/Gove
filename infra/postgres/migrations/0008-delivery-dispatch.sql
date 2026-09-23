ALTER TABLE dispatch.driver_work_states
  ADD COLUMN current_delivery_id uuid REFERENCES delivery.deliveries(id) ON DELETE RESTRICT;

ALTER TABLE dispatch.driver_work_states
  DROP CONSTRAINT dispatch_driver_work_states_trip_binding,
  ADD CONSTRAINT dispatch_driver_work_states_work_binding
    CHECK (
      (work_state IN ('OFFLINE', 'AVAILABLE')
        AND current_trip_id IS NULL AND current_delivery_id IS NULL)
      OR
      (work_state IN ('RESERVED', 'TO_PICKUP', 'ON_TRIP') AND (
        (current_trip_id IS NOT NULL AND current_delivery_id IS NULL)
        OR (current_trip_id IS NULL AND current_delivery_id IS NOT NULL)
      ))
    );

CREATE UNIQUE INDEX dispatch_driver_work_states_one_delivery_per_driver
  ON dispatch.driver_work_states (current_delivery_id)
  WHERE current_delivery_id IS NOT NULL;

CREATE TABLE delivery.driver_reservations (
  id uuid PRIMARY KEY,
  driver_user_id uuid NOT NULL REFERENCES driver.driver_profiles(user_id) ON DELETE RESTRICT,
  delivery_id uuid NOT NULL REFERENCES delivery.deliveries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution_reason text,
  resolved_by_user_id uuid REFERENCES identity.users(id) ON DELETE RESTRICT,
  CONSTRAINT delivery_driver_reservations_identity UNIQUE (id, delivery_id, driver_user_id),
  CONSTRAINT delivery_driver_reservations_expiry CHECK (expires_at > created_at),
  CONSTRAINT delivery_driver_reservations_terminal CHECK (
    (status = 'ACTIVE' AND resolved_at IS NULL AND resolution_reason IS NULL)
    OR (status <> 'ACTIVE' AND resolved_at IS NOT NULL AND char_length(btrim(resolution_reason)) BETWEEN 1 AND 240)
  )
);

CREATE UNIQUE INDEX delivery_reservations_one_active_driver
  ON delivery.driver_reservations (driver_user_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX delivery_reservations_one_active_delivery
  ON delivery.driver_reservations (delivery_id) WHERE status = 'ACTIVE';

CREATE TABLE delivery.delivery_offers (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES delivery.deliveries(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL,
  driver_user_id uuid NOT NULL REFERENCES driver.driver_profiles(user_id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED')),
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution_reason text,
  accepted_by_user_id uuid REFERENCES identity.users(id) ON DELETE RESTRICT,
  acceptance_idempotency_key text,
  accepted_delivery_version integer,
  CONSTRAINT delivery_offers_reservation_identity
    FOREIGN KEY (reservation_id, delivery_id, driver_user_id)
    REFERENCES delivery.driver_reservations (id, delivery_id, driver_user_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_offers_one_offer_per_reservation UNIQUE (reservation_id),
  CONSTRAINT delivery_offers_expiry CHECK (expires_at > offered_at)
);

CREATE UNIQUE INDEX delivery_offers_one_pending_delivery
  ON delivery.delivery_offers (delivery_id) WHERE status = 'PENDING';

CREATE TABLE delivery.assignments (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES delivery.deliveries(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL REFERENCES delivery.delivery_offers(id) ON DELETE RESTRICT,
  driver_user_id uuid NOT NULL REFERENCES driver.driver_profiles(user_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT delivery_assignments_one_offer UNIQUE (offer_id),
  CONSTRAINT delivery_assignments_terminal CHECK (
    (status = 'ACTIVE' AND completed_at IS NULL) OR (status <> 'ACTIVE' AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX delivery_assignments_one_active_delivery
  ON delivery.assignments (delivery_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX delivery_assignments_one_active_driver
  ON delivery.assignments (driver_user_id) WHERE status = 'ACTIVE';
