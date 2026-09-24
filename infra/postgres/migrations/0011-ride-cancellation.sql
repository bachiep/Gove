CREATE TABLE trip.cancellations (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL UNIQUE REFERENCES trip.trips(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  actor_role text NOT NULL,
  reason_code text NOT NULL,
  reason_detail text,
  rule_code text NOT NULL,
  correlation_id text NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_cancellations_actor_role
    CHECK (actor_role IN ('CUSTOMER', 'DRIVER', 'OPERATOR')),
  CONSTRAINT trip_cancellations_reason_code
    CHECK (
      reason_code IN (
        'CHANGE_OF_PLANS',
        'DRIVER_DELAY',
        'DRIVER_REQUESTED_CANCELLATION',
        'SAFETY_CONCERN',
        'VEHICLE_ISSUE',
        'OTHER'
      )
    ),
  CONSTRAINT trip_cancellations_reason_detail
    CHECK (
      (
        reason_code = 'OTHER'
        AND char_length(btrim(reason_detail)) BETWEEN 3 AND 240
      )
      OR (
        reason_code <> 'OTHER'
        AND (
          reason_detail IS NULL
          OR char_length(btrim(reason_detail)) BETWEEN 3 AND 240
        )
      )
    ),
  CONSTRAINT trip_cancellations_rule_code
    CHECK (
      rule_code IN (
        'CUSTOMER_PRE_TRIP',
        'CUSTOMER_AT_PICKUP',
        'DRIVER_AT_PICKUP',
        'OPERATOR_PRE_TRIP',
        'OPERATOR_ASSIGNED',
        'OPERATOR_IN_PROGRESS'
      )
    ),
  CONSTRAINT trip_cancellations_correlation_id_not_blank
    CHECK (char_length(btrim(correlation_id)) BETWEEN 1 AND 128)
);

CREATE INDEX trip_cancellations_by_actor
  ON trip.cancellations (actor_user_id, cancelled_at DESC);
