ALTER TABLE driver.vehicles
  ADD COLUMN review_reason text,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by_user_id uuid REFERENCES identity.users(id) ON DELETE RESTRICT;

CREATE TABLE driver.onboarding_approval_actions (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL
    CHECK (subject_type IN ('DRIVER_PROFILE', 'VEHICLE')),
  driver_user_id uuid NOT NULL REFERENCES driver.driver_profiles(user_id) ON DELETE RESTRICT,
  vehicle_id uuid REFERENCES driver.vehicles(id) ON DELETE RESTRICT,
  previous_status text NOT NULL
    CHECK (previous_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'RETIRED')),
  resulting_status text NOT NULL CHECK (resulting_status IN ('APPROVED', 'REJECTED')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 240),
  operator_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_approval_actions_subject
    CHECK (
      (subject_type = 'DRIVER_PROFILE' AND vehicle_id IS NULL)
      OR (subject_type = 'VEHICLE' AND vehicle_id IS NOT NULL)
    )
);

CREATE INDEX onboarding_approval_actions_driver_history
  ON driver.onboarding_approval_actions (driver_user_id, created_at DESC);

CREATE INDEX onboarding_approval_actions_vehicle_history
  ON driver.onboarding_approval_actions (vehicle_id, created_at DESC)
  WHERE vehicle_id IS NOT NULL;
