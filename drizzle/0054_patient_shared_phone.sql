-- A phone number is contact data, not patient identity.
--
-- patient_id is now the immutable CRM identity. Remove the compatibility-era
-- UNIQUE(organization_id, phone_normalized) constraint so two different people
-- in the same tenant may share one family/contact number. Existing rows keep
-- their patient_id unchanged; no profile or historical booking is merged,
-- duplicated, or inferred from phone/DOB.
--
-- SQLite validates trigger bodies while a referenced table is rebuilt. The
-- booking/communication guards created by 0051/0052 reference patient_profiles,
-- so suspend only those external guards around the table swap and recreate the
-- identical tenant + patient_id invariants immediately afterwards.

DROP TRIGGER IF EXISTS `bookings_patient_link_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `bookings_patient_link_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `patient_communications_patient_link_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `patient_communications_patient_link_update`;
--> statement-breakpoint

CREATE TABLE `patient_profiles_v4` (
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
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `patient_profiles_v4` (
  `patient_id`, `organization_id`, `phone_normalized`, `display_name`, `birth_year`, `birth_date`,
  `email`, `address`, `tags`, `notes`, `do_not_contact`, `telegram_chat_id`,
  `updated_by`, `updated_at`
)
SELECT
  `patient_id`, `organization_id`, `phone_normalized`, `display_name`, `birth_year`, `birth_date`,
  `email`, `address`, `tags`, `notes`, `do_not_contact`, `telegram_chat_id`,
  `updated_by`, `updated_at`
FROM `patient_profiles`;
--> statement-breakpoint
DROP TABLE `patient_profiles`;
--> statement-breakpoint
ALTER TABLE `patient_profiles_v4` RENAME TO `patient_profiles`;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `patient_profiles_phone_idx`
ON `patient_profiles` (`phone_normalized`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_profiles_org_phone_idx`
ON `patient_profiles` (`organization_id`, `phone_normalized`);
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
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_profiles_organization_immutable`
BEFORE UPDATE OF `organization_id` ON `patient_profiles`
FOR EACH ROW
WHEN NEW.organization_id != OLD.organization_id
BEGIN
  SELECT RAISE(ABORT, 'patient organization is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_profiles_linked_delete_guard`
BEFORE DELETE ON `patient_profiles`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.organization_id = OLD.organization_id
    AND b.patient_id = OLD.patient_id
)
BEGIN
  SELECT RAISE(ABORT, 'linked patient cannot be deleted');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `bookings_patient_link_insert`
BEFORE INSERT ON `bookings`
FOR EACH ROW
WHEN NEW.patient_id != ''
  AND NOT EXISTS (
    SELECT 1 FROM patient_profiles p
    WHERE p.organization_id = NEW.organization_id
      AND p.patient_id = NEW.patient_id
  )
BEGIN
  SELECT RAISE(ABORT, 'booking patient link invalid');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `bookings_patient_link_update`
BEFORE UPDATE OF `organization_id`, `patient_id` ON `bookings`
FOR EACH ROW
WHEN NEW.patient_id != ''
  AND NOT EXISTS (
    SELECT 1 FROM patient_profiles p
    WHERE p.organization_id = NEW.organization_id
      AND p.patient_id = NEW.patient_id
  )
BEGIN
  SELECT RAISE(ABORT, 'booking patient link invalid');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_communications_patient_link_insert`
BEFORE INSERT ON `patient_communications`
FOR EACH ROW
WHEN NEW.patient_id != ''
  AND NOT EXISTS (
    SELECT 1 FROM patient_profiles p
    WHERE p.organization_id = NEW.organization_id
      AND p.patient_id = NEW.patient_id
  )
BEGIN
  SELECT RAISE(ABORT, 'patient communication link invalid');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_communications_patient_link_update`
BEFORE UPDATE OF `organization_id`, `patient_id` ON `patient_communications`
FOR EACH ROW
WHEN NEW.patient_id != ''
  AND NOT EXISTS (
    SELECT 1 FROM patient_profiles p
    WHERE p.organization_id = NEW.organization_id
      AND p.patient_id = NEW.patient_id
  )
BEGIN
  SELECT RAISE(ABORT, 'patient communication link invalid');
END;
