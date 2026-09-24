CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE audit.operator_diagnostic_actions (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trip.trips(id) ON DELETE RESTRICT,
  operator_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action = 'DIAGNOSTIC_REVIEW'),
  reason text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_diagnostic_actions_reason_not_blank
    CHECK (char_length(btrim(reason)) BETWEEN 3 AND 240)
);

CREATE INDEX operator_diagnostic_actions_by_trip
  ON audit.operator_diagnostic_actions (trip_id, created_at ASC);
