-- Immutable patient identity foundation.
--
-- Historical CRM profiles were keyed by (organization_id, phone_normalized).
-- Introduce an opaque patient_id as the real row identity while preserving the
-- existing tenant+phone uniqueness contract for this compatibility phase.
-- Bookings are intentionally NOT backfilled or linked here: a phone number is
-- not sufficient evidence that historical studies belong to one person.

CREATE TABLE `patient_profiles_v3` (
  `patient_id` text PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  `organization_id` integer NOT NULL DEFAULT 1,
  `phone_normalized` text NOT NULL,
  `display_name` text NOT NULL DEFAULT '',
  `birth_year` integer NOT NULL DEFAULT 0,
  `birth_date` text NOT NULL DEFAULT '',
  `email` text NOT NULL DEFAULT '',
  `address` text NOT NULL DEFAULT '',
  `tags` text NOT NULL DEFAULT '',
  `notes` text NOT NULL DEFAULT '',
  `do_not_contact` integer NOT NULL DEFAULT 0,
  `telegram_chat_id` text NOT NULL DEFAULT '',
  `updated_by` text NOT NULL,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`organization_id`, `phone_normalized`)
);
--> statement-breakpoint
INSERT INTO `patient_profiles_v3` (
  `organization_id`, `phone_normalized`, `display_name`, `birth_year`, `birth_date`,
  `email`, `address`, `tags`, `notes`, `do_not_contact`, `telegram_chat_id`,
  `updated_by`, `updated_at`
)
SELECT
  `organization_id`, `phone_normalized`, `display_name`, `birth_year`, `birth_date`,
  `email`, `address`, `tags`, `notes`, `do_not_contact`, `telegram_chat_id`,
  `updated_by`, `updated_at`
FROM `patient_profiles`;
--> statement-breakpoint
DROP TABLE `patient_profiles`;
--> statement-breakpoint
ALTER TABLE `patient_profiles_v3` RENAME TO `patient_profiles`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_profiles_phone_idx`
ON `patient_profiles` (`phone_normalized`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_profiles_org_updated_idx`
ON `patient_profiles` (`organization_id`, `updated_at`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_profiles_patient_id_immutable`
BEFORE UPDATE OF `patient_id` ON `patient_profiles`
FOR EACH ROW
WHEN NEW.patient_id != OLD.patient_id
BEGIN
  SELECT RAISE(ABORT, 'patient id is immutable');
END;
