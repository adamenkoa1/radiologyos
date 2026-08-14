-- Patient cabinet security hardening.
-- A possession-verified phone number can be shared by multiple family members.
-- Carry the identity proof (DOB or exact booking code) from OTP challenge into
-- the authenticated patient session so one person's proof cannot expose every
-- medical record attached to the same phone number.

ALTER TABLE patient_otp_challenges ADD COLUMN identity_kind text DEFAULT '' NOT NULL;
ALTER TABLE patient_otp_challenges ADD COLUMN identity_value text DEFAULT '' NOT NULL;
ALTER TABLE patient_sessions ADD COLUMN identity_kind text DEFAULT '' NOT NULL;
ALTER TABLE patient_sessions ADD COLUMN identity_value text DEFAULT '' NOT NULL;

-- Existing active challenges/sessions were created without an identity scope.
-- Fail closed: require a fresh OTP flow after this migration instead of trying
-- to infer which person a previously issued token belonged to.
UPDATE patient_otp_challenges
SET consumed_at = CURRENT_TIMESTAMP
WHERE consumed_at = '';
DELETE FROM patient_sessions;

CREATE INDEX IF NOT EXISTS patient_sessions_identity_scope_idx
ON patient_sessions (organization_id, phone_normalized, identity_kind, identity_value, expires_at);

CREATE INDEX IF NOT EXISTS patient_otp_identity_scope_idx
ON patient_otp_challenges (organization_id, phone_normalized, identity_kind, identity_value, created_at);

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
