-- Patient cabinet security hardening.
-- A possession-verified phone number can be shared by multiple family members.
-- Carry the identity proof (DOB or exact booking code) from OTP challenge into
-- the authenticated patient session so one person's proof cannot expose every
-- medical record attached to the same phone number.

ALTER TABLE patient_otp_challenges ADD COLUMN identity_kind text DEFAULT '' NOT NULL;
ALTER TABLE patient_otp_challenges ADD COLUMN identity_value text DEFAULT '' NOT NULL;
ALTER TABLE patient_sessions ADD COLUMN identity_kind text DEFAULT '' NOT NULL;
ALTER TABLE patient_sessions ADD COLUMN identity_value text DEFAULT '' NOT NULL;
ALTER TABLE telegram_link_tokens ADD COLUMN identity_kind text DEFAULT '' NOT NULL;
ALTER TABLE telegram_link_tokens ADD COLUMN identity_value text DEFAULT '' NOT NULL;

-- Existing active challenges/sessions/link tokens were created without an
-- identity scope. Fail closed and require fresh verification/linking.
UPDATE patient_otp_challenges
SET consumed_at = CURRENT_TIMESTAMP
WHERE consumed_at = '';
DELETE FROM patient_sessions;
DELETE FROM telegram_link_tokens;

-- Legacy Telegram chat IDs were phone-wide and cannot be mapped safely to a
-- specific person when relatives share one number. Clear them instead of
-- guessing ownership; users can reconnect Telegram from a freshly scoped
-- patient session.
UPDATE patient_profiles SET telegram_chat_id = '' WHERE telegram_chat_id != '';

CREATE INDEX IF NOT EXISTS patient_sessions_identity_scope_idx
ON patient_sessions (organization_id, phone_normalized, identity_kind, identity_value, expires_at);

CREATE INDEX IF NOT EXISTS patient_otp_identity_scope_idx
ON patient_otp_challenges (organization_id, phone_normalized, identity_kind, identity_value, created_at);

CREATE TABLE IF NOT EXISTS patient_telegram_identities (
  organization_id integer NOT NULL,
  phone_normalized text NOT NULL,
  identity_kind text NOT NULL,
  identity_value text NOT NULL,
  telegram_chat_id text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, phone_normalized, identity_kind, identity_value)
);

CREATE INDEX IF NOT EXISTS patient_telegram_chat_idx
ON patient_telegram_identities (telegram_chat_id)
WHERE telegram_chat_id != '';

CREATE INDEX IF NOT EXISTS telegram_link_tokens_identity_scope_idx
ON telegram_link_tokens (organization_id, phone_normalized, identity_kind, identity_value, expires_at);

CREATE TRIGGER IF NOT EXISTS patient_otp_identity_scope_insert
BEFORE INSERT ON patient_otp_challenges
FOR EACH ROW
WHEN NEW.identity_kind NOT IN ('dob','booking') OR NEW.identity_value = ''
BEGIN
  SELECT RAISE(ABORT, 'patient OTP identity scope required');
END;

CREATE TRIGGER IF NOT EXISTS patient_otp_identity_scope_update
BEFORE UPDATE OF identity_kind, identity_value ON patient_otp_challenges
FOR EACH ROW
WHEN NEW.identity_kind NOT IN ('dob','booking') OR NEW.identity_value = ''
BEGIN
  SELECT RAISE(ABORT, 'patient OTP identity scope required');
END;

CREATE TRIGGER IF NOT EXISTS patient_session_identity_scope_insert
BEFORE INSERT ON patient_sessions
FOR EACH ROW
WHEN NEW.identity_kind NOT IN ('dob','booking') OR NEW.identity_value = ''
BEGIN
  SELECT RAISE(ABORT, 'patient session identity scope required');
END;

CREATE TRIGGER IF NOT EXISTS patient_session_identity_scope_update
BEFORE UPDATE OF identity_kind, identity_value ON patient_sessions
FOR EACH ROW
WHEN NEW.identity_kind NOT IN ('dob','booking') OR NEW.identity_value = ''
BEGIN
  SELECT RAISE(ABORT, 'patient session identity scope required');
END;

CREATE TRIGGER IF NOT EXISTS telegram_link_identity_scope_insert
BEFORE INSERT ON telegram_link_tokens
FOR EACH ROW
WHEN NEW.identity_kind NOT IN ('dob','booking') OR NEW.identity_value = ''
BEGIN
  SELECT RAISE(ABORT, 'Telegram identity scope required');
END;

CREATE TRIGGER IF NOT EXISTS telegram_link_identity_scope_update
BEFORE UPDATE OF identity_kind, identity_value ON telegram_link_tokens
FOR EACH ROW
WHEN NEW.identity_kind NOT IN ('dob','booking') OR NEW.identity_value = ''
BEGIN
  SELECT RAISE(ABORT, 'Telegram identity scope required');
END;

CREATE TRIGGER IF NOT EXISTS patient_telegram_identity_insert
BEFORE INSERT ON patient_telegram_identities
FOR EACH ROW
WHEN NEW.identity_kind NOT IN ('dob','booking') OR NEW.identity_value = ''
BEGIN
  SELECT RAISE(ABORT, 'patient Telegram identity scope required');
END;

CREATE TRIGGER IF NOT EXISTS patient_telegram_identity_update
BEFORE UPDATE OF identity_kind, identity_value ON patient_telegram_identities
FOR EACH ROW
WHEN NEW.identity_kind NOT IN ('dob','booking') OR NEW.identity_value = ''
BEGIN
  SELECT RAISE(ABORT, 'patient Telegram identity scope required');
END;
