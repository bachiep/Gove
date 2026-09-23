CREATE TABLE driver.driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE RESTRICT,
  phone text,
  approval_status text NOT NULL DEFAULT 'PENDING'
    CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  review_reason text,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES identity.users(id) ON DELETE RESTRICT,
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_profiles_review_metadata
    CHECK (
      (approval_status = 'PENDING' AND reviewed_at IS NULL)
      OR approval_status <> 'PENDING'
    )
);

CREATE TRIGGER driver_profiles_touch_updated_at
BEFORE UPDATE ON driver.driver_profiles
FOR EACH ROW EXECUTE FUNCTION public.gove_touch_updated_at();

CREATE TABLE driver.vehicles (
  id uuid PRIMARY KEY,
  driver_user_id uuid NOT NULL REFERENCES driver.driver_profiles(user_id) ON DELETE RESTRICT,
  vehicle_class text NOT NULL
    CHECK (vehicle_class IN ('MOTORBIKE', 'STANDARD_CAR', 'PREMIUM_CAR', 'VAN')),
  make text NOT NULL,
  model text NOT NULL,
  model_year smallint NOT NULL CHECK (model_year BETWEEN 1900 AND 2100),
  plate_normalized text NOT NULL,
  approval_status text NOT NULL DEFAULT 'PENDING'
    CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'RETIRED')),
  is_selected boolean NOT NULL DEFAULT false,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_vehicles_make_not_blank CHECK (char_length(btrim(make)) BETWEEN 1 AND 80),
  CONSTRAINT driver_vehicles_model_not_blank CHECK (char_length(btrim(model)) BETWEEN 1 AND 80),
  CONSTRAINT driver_vehicles_plate_normalized CHECK (
    plate_normalized = upper(plate_normalized)
    AND char_length(plate_normalized) BETWEEN 3 AND 20
  ),
  CONSTRAINT driver_vehicles_selected_requires_approval
    CHECK (NOT is_selected OR approval_status = 'APPROVED'),
  CONSTRAINT driver_vehicles_retired_metadata
    CHECK (
      (approval_status <> 'RETIRED' AND retired_at IS NULL)
      OR (approval_status = 'RETIRED' AND retired_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX driver_vehicles_active_plate_unique
  ON driver.vehicles (plate_normalized)
  WHERE approval_status <> 'RETIRED';

CREATE UNIQUE INDEX driver_vehicles_one_selected_per_driver
  ON driver.vehicles (driver_user_id)
  WHERE is_selected;

CREATE INDEX driver_vehicles_eligibility_lookup
  ON driver.vehicles (driver_user_id, vehicle_class)
  WHERE approval_status = 'APPROVED' AND is_selected;

CREATE TRIGGER driver_vehicles_touch_updated_at
BEFORE UPDATE ON driver.vehicles
FOR EACH ROW EXECUTE FUNCTION public.gove_touch_updated_at();
