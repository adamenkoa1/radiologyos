-- Bind possession-verified patient auth to the immutable patient identity when
-- an exact booking -> patient link is already known.
--
-- Legacy sessions/challenges remain valid with patient_id=''. This keeps the
-- current phone + DOB / booking-code portal compatible for historical unlinked
-- bookings, while exact linked identities can no longer expand by phone/DOB.

ALTER TABLE `patient_otp_challenges` ADD COLUMN `patient_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `patient_sessions` ADD COLUMN `patient_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_otp_patient_idx`
ON `patient_otp_challenges` (`organization_id`, `patient_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_sessions_patient_idx`
ON `patient_sessions` (`organization_id`, `patient_id`, `expires_at`);
--> statement-breakpoint

-- A non-empty immutable patient id may only be attached when the exact auth
-- scope is backed by a booking explicitly linked to that same patient.
CREATE TRIGGER IF NOT EXISTS `patient_otp_patient_link_insert`
BEFORE INSERT ON `patient_otp_challenges`
FOR EACH ROW
WHEN NEW.patient_id != ''
  AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.organization_id = NEW.organization_id
      AND b.patient_id = NEW.patient_id
      AND b.phone_normalized = NEW.phone_normalized
      AND (
        (NEW.identity_kind = 'dob' AND b.date_of_birth = NEW.identity_value)
        OR (NEW.identity_kind = 'booking' AND b.code = NEW.identity_value)
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'patient OTP patient link invalid');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_session_patient_link_insert`
BEFORE INSERT ON `patient_sessions`
FOR EACH ROW
WHEN NEW.patient_id != ''
  AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.organization_id = NEW.organization_id
      AND b.patient_id = NEW.patient_id
      AND b.phone_normalized = NEW.phone_normalized
      AND (
        (NEW.identity_kind = 'dob' AND b.date_of_birth = NEW.identity_value)
        OR (NEW.identity_kind = 'booking' AND b.code = NEW.identity_value)
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'patient session patient link invalid');
END;
--> statement-breakpoint

-- Auth identity cannot be retargeted after issuance, even by direct SQL.
CREATE TRIGGER IF NOT EXISTS `patient_otp_patient_id_immutable`
BEFORE UPDATE OF `patient_id` ON `patient_otp_challenges`
FOR EACH ROW
WHEN NEW.patient_id != OLD.patient_id
BEGIN
  SELECT RAISE(ABORT, 'patient OTP patient id is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_session_patient_id_immutable`
BEFORE UPDATE OF `patient_id` ON `patient_sessions`
FOR EACH ROW
WHEN NEW.patient_id != OLD.patient_id
BEGIN
  SELECT RAISE(ABORT, 'patient session patient id is immutable');
END;
