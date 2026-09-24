ALTER TABLE delivery.assignments
  ADD COLUMN pickup_custody_confirmation text,
  ADD COLUMN pickup_confirmed_at timestamptz;

ALTER TABLE delivery.assignments
  ADD CONSTRAINT delivery_assignments_pickup_confirmation
    CHECK (
      (pickup_custody_confirmation IS NULL AND pickup_confirmed_at IS NULL)
      OR (
        char_length(btrim(pickup_custody_confirmation)) BETWEEN 1 AND 120
        AND pickup_confirmed_at IS NOT NULL
      )
    );

CREATE TABLE delivery.delivery_proofs (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL UNIQUE REFERENCES delivery.deliveries(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL UNIQUE REFERENCES delivery.assignments(id) ON DELETE RESTRICT,
  recorded_by_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  confirmation_text text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_proofs_confirmation_not_blank
    CHECK (char_length(btrim(confirmation_text)) BETWEEN 1 AND 120)
);
