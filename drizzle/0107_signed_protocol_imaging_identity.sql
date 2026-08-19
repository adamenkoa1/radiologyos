-- A signed/issued report is immutable clinical evidence. Its DICOM study link
-- must therefore not be silently created, removed, moved, or relinked after
-- signing. Operational PACS facts (counts/status/provenance) remain refreshable.

CREATE TRIGGER `imaging_studies_signed_protocol_insert_guard`
BEFORE INSERT ON `imaging_studies`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `protocols` p
  WHERE p.`organization_id` = NEW.`organization_id`
    AND p.`booking_id` = NEW.`booking_id`
    AND p.`status` IN ('signed','issued')
)
AND NOT EXISTS (
  SELECT 1 FROM `imaging_studies` i
  WHERE i.`booking_id` = NEW.`booking_id`
)
BEGIN
  SELECT RAISE(ABORT, 'signed protocol imaging identity is immutable');
END;
--> statement-breakpoint

-- SQLite executes BEFORE INSERT triggers before ON CONFLICT DO UPDATE. Existing
-- booking rows are therefore allowed through the INSERT guard above and are
-- checked here against their previous clinical identity.
CREATE TRIGGER `imaging_studies_signed_protocol_update_guard`
BEFORE UPDATE OF `organization_id`, `booking_id`, `accession_number`, `study_instance_uid`, `modality`, `study_datetime`
ON `imaging_studies`
FOR EACH ROW
WHEN (
  EXISTS (
    SELECT 1 FROM `protocols` p
    WHERE p.`organization_id` = OLD.`organization_id`
      AND p.`booking_id` = OLD.`booking_id`
      AND p.`status` IN ('signed','issued')
  )
  OR EXISTS (
    SELECT 1 FROM `protocols` p
    WHERE p.`organization_id` = NEW.`organization_id`
      AND p.`booking_id` = NEW.`booking_id`
      AND p.`status` IN ('signed','issued')
  )
)
AND (
  NEW.`organization_id` != OLD.`organization_id`
  OR NEW.`booking_id` != OLD.`booking_id`
  OR COALESCE(NEW.`accession_number`, '') != COALESCE(OLD.`accession_number`, '')
  OR COALESCE(NEW.`study_instance_uid`, '') != COALESCE(OLD.`study_instance_uid`, '')
  OR COALESCE(NEW.`modality`, '') != COALESCE(OLD.`modality`, '')
  OR COALESCE(NEW.`study_datetime`, '') != COALESCE(OLD.`study_datetime`, '')
)
BEGIN
  SELECT RAISE(ABORT, 'signed protocol imaging identity is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER `imaging_studies_signed_protocol_delete_guard`
BEFORE DELETE ON `imaging_studies`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `protocols` p
  WHERE p.`organization_id` = OLD.`organization_id`
    AND p.`booking_id` = OLD.`booking_id`
    AND p.`status` IN ('signed','issued')
)
BEGIN
  SELECT RAISE(ABORT, 'signed protocol imaging identity is immutable');
END;
