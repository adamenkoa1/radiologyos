-- Exact patient identity for CRM communications.
--
-- Existing chat/WhatsApp/call history is intentionally left unlinked. A phone
-- number is contact data, not sufficient evidence that a communication belongs
-- to one immutable patient when a family may share that number.
ALTER TABLE `patient_communications` ADD COLUMN `patient_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_communications_org_patient_idx`
ON `patient_communications` (`organization_id`, `patient_id`, `created_at`);
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
