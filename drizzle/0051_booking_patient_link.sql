-- Explicit patient linkage for bookings.
--
-- Historical rows intentionally remain unlinked. A phone number (even together
-- with DOB) is not sufficient evidence to attach old studies to one immutable
-- patient identity. New trusted workflows may set patient_id explicitly.
ALTER TABLE `bookings` ADD COLUMN `patient_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bookings_org_patient_idx`
ON `bookings` (`organization_id`, `patient_id`, `desired_date`)
WHERE `patient_id` != '';
--> statement-breakpoint
-- A booking may only point at a patient profile owned by the same tenant.
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
-- Tenant ownership of an identity cannot be moved underneath linked bookings.
CREATE TRIGGER IF NOT EXISTS `patient_profiles_organization_immutable`
BEFORE UPDATE OF `organization_id` ON `patient_profiles`
FOR EACH ROW
WHEN NEW.organization_id != OLD.organization_id
BEGIN
  SELECT RAISE(ABORT, 'patient organization is immutable');
END;
--> statement-breakpoint
-- Do not allow a profile to disappear while clinical bookings still reference it.
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
