CREATE OR REPLACE FUNCTION public.gove_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE identity.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  auth_epoch integer NOT NULL DEFAULT 0 CHECK (auth_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_users_email_normalized
    CHECK (
      email = lower(email)
      AND char_length(email) BETWEEN 3 AND 320
      AND position('@' IN email) > 1
    ),
  CONSTRAINT identity_users_display_name_not_blank
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120)
);

CREATE TRIGGER identity_users_touch_updated_at
BEFORE UPDATE ON identity.users
FOR EACH ROW EXECUTE FUNCTION public.gove_touch_updated_at();

CREATE TABLE identity.roles (
  code text PRIMARY KEY CHECK (code IN ('CUSTOMER', 'DRIVER', 'OPERATOR')),
  description text NOT NULL
);

INSERT INTO identity.roles (code, description)
VALUES
  ('CUSTOMER', 'May request and pay for trips'),
  ('DRIVER', 'May provide transportation after approval'),
  ('OPERATOR', 'May perform authorized operational actions')
ON CONFLICT (code) DO UPDATE
SET description = EXCLUDED.description;

CREATE TABLE identity.user_roles (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  role_code text NOT NULL REFERENCES identity.roles(code) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, role_code),
  CONSTRAINT identity_user_roles_revocation_order
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE INDEX identity_user_roles_active_by_user
  ON identity.user_roles (user_id, role_code)
  WHERE revoked_at IS NULL;

CREATE TABLE identity.credentials (
  user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_credentials_password_hash_not_blank
    CHECK (char_length(password_hash) >= 32)
);

CREATE TRIGGER identity_credentials_touch_updated_at
BEFORE UPDATE ON identity.credentials
FOR EACH ROW EXECUTE FUNCTION public.gove_touch_updated_at();

CREATE TABLE identity.refresh_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  family_id uuid NOT NULL,
  token_digest bytea NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'ROTATED', 'REVOKED', 'EXPIRED')),
  revoked_at timestamptz,
  revoke_reason text,
  replaced_by_session_id uuid,
  CONSTRAINT identity_refresh_sessions_expiry_after_issue
    CHECK (expires_at > issued_at),
  CONSTRAINT identity_refresh_sessions_digest_size
    CHECK (octet_length(token_digest) = 32),
  CONSTRAINT identity_refresh_sessions_revocation_metadata
    CHECK (
      (status IN ('ACTIVE', 'EXPIRED') AND revoked_at IS NULL AND revoke_reason IS NULL)
      OR (status IN ('ROTATED', 'REVOKED') AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
    )
);

CREATE UNIQUE INDEX identity_refresh_sessions_one_active_per_family
  ON identity.refresh_sessions (family_id)
  WHERE status = 'ACTIVE';

CREATE INDEX identity_refresh_sessions_active_by_user
  ON identity.refresh_sessions (user_id, expires_at DESC)
  WHERE status = 'ACTIVE';

CREATE TABLE identity.command_receipts (
  operation text NOT NULL,
  subject_digest bytea NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint bytea NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, subject_digest, idempotency_key),
  CONSTRAINT identity_command_receipts_subject_digest_size
    CHECK (octet_length(subject_digest) = 32),
  CONSTRAINT identity_command_receipts_fingerprint_size
    CHECK (octet_length(request_fingerprint) = 32)
);
