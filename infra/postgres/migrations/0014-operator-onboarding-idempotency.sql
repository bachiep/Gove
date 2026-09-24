CREATE SCHEMA IF NOT EXISTS operator;

CREATE TABLE operator.command_receipts (
  actor_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (
    operation IN (
      'APPROVE_DRIVER',
      'REJECT_DRIVER',
      'APPROVE_VEHICLE',
      'REJECT_VEHICLE'
    )
  ),
  idempotency_key text NOT NULL,
  request_fingerprint bytea NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, operation, idempotency_key),
  CONSTRAINT operator_command_receipts_key_length
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT operator_command_receipts_fingerprint_size
    CHECK (octet_length(request_fingerprint) = 32)
);
