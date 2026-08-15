-- Telegram delivery contains patient-specific appointment information, so an
-- exact booking -> patient link must never fall back to phone + DOB ownership.
-- Carry immutable patient_id through short-lived link tokens and persisted
-- Telegram identities. Existing links predate this proof and are removed rather
-- than guessed; patients can reconnect from a freshly verified cabinet session.

ALTER TABLE `telegram_link_tokens` ADD COLUMN `patient_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `patient_telegram_identities` ADD COLUMN `patient_id` text NOT NULL DEFAULT '';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `telegram_link_tokens_patient_idx`
ON `telegram_link_tokens` (`organization_id`, `patient_id`, `expires_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_telegram_patient_idx`
ON `patient_telegram_identities` (`organization_id`, `patient_id`, `updated_at`);
--> statement-breakpoint

-- Old tokens/links cannot prove immutable ownership. Fail closed instead of
-- attributing a family-phone/DOB identity to a person retroactively. Remove the
-- identity rows too so a fresh exact link does not collide with legacy scope.
DELETE FROM `telegram_link_tokens`;
--> statement-breakpoint
DELETE FROM `patient_telegram_identities`;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `telegram_link_patient_link_insert`
BEFORE INSERT ON `telegram_link_tokens`
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
  SELECT RAISE(ABORT, 'Telegram patient link invalid');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `telegram_identity_patient_link_insert`
BEFORE INSERT ON `patient_telegram_identities`
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
  SELECT RAISE(ABORT, 'patient Telegram patient link invalid');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `telegram_link_patient_id_immutable`
BEFORE UPDATE OF `patient_id` ON `telegram_link_tokens`
FOR EACH ROW
WHEN NEW.patient_id != OLD.patient_id
BEGIN
  SELECT RAISE(ABORT, 'Telegram patient id is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `telegram_identity_patient_id_immutable`
BEFORE UPDATE OF `patient_id` ON `patient_telegram_identities`
FOR EACH ROW
WHEN NEW.patient_id != OLD.patient_id
BEGIN
  SELECT RAISE(ABORT, 'patient Telegram patient id is immutable');
END;
