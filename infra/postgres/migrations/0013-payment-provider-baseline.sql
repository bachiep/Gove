ALTER TABLE payment.payment_attempts
  ADD COLUMN provider text NOT NULL DEFAULT 'SIMULATOR';

ALTER TABLE payment.payment_attempts
  ADD CONSTRAINT payment_attempts_provider
  CHECK (provider IN ('SIMULATOR', 'MOMO', 'SEPAY'));
