-- DICOM/PACS hardening: an imaging link must belong to the same tenant as its
-- booking, and one StudyInstanceUID must not be linked to two bookings inside
-- the same organization.

-- Repair any historical tenant drift that can be resolved unambiguously from
-- the globally unique booking primary key.
UPDATE imaging_studies
SET organization_id = (
  SELECT b.organization_id FROM bookings b WHERE b.id = imaging_studies.booking_id
)
WHERE EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.id = imaging_studies.booking_id
    AND b.organization_id != imaging_studies.organization_id
);

CREATE INDEX IF NOT EXISTS imaging_studies_org_uid_idx
ON imaging_studies (organization_id, study_instance_uid)
WHERE study_instance_uid != '';

CREATE TRIGGER IF NOT EXISTS imaging_studies_booking_tenant_insert
BEFORE INSERT ON imaging_studies
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.id = NEW.booking_id AND b.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'imaging study booking tenant mismatch');
END;

CREATE TRIGGER IF NOT EXISTS imaging_studies_booking_tenant_update
BEFORE UPDATE OF booking_id, organization_id ON imaging_studies
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.id = NEW.booking_id AND b.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'imaging study booking tenant mismatch');
END;

CREATE TRIGGER IF NOT EXISTS imaging_studies_uid_unique_insert
BEFORE INSERT ON imaging_studies
FOR EACH ROW
WHEN NEW.study_instance_uid != '' AND EXISTS (
  SELECT 1 FROM imaging_studies i
  WHERE i.organization_id = NEW.organization_id
    AND i.study_instance_uid = NEW.study_instance_uid
    AND i.booking_id != NEW.booking_id
)
BEGIN
  SELECT RAISE(ABORT, 'DICOM StudyInstanceUID already linked');
END;

CREATE TRIGGER IF NOT EXISTS imaging_studies_uid_unique_update
BEFORE UPDATE OF study_instance_uid, organization_id, booking_id ON imaging_studies
FOR EACH ROW
WHEN NEW.study_instance_uid != '' AND EXISTS (
  SELECT 1 FROM imaging_studies i
  WHERE i.organization_id = NEW.organization_id
    AND i.study_instance_uid = NEW.study_instance_uid
    AND i.booking_id != NEW.booking_id
)
BEGIN
  SELECT RAISE(ABORT, 'DICOM StudyInstanceUID already linked');
END;

-- PACS settings are tenant-owned infrastructure metadata. API writes are
-- already tenant-scoped; these guards make invalid organization references
-- impossible at the database layer as well.
CREATE TRIGGER IF NOT EXISTS pacs_settings_org_insert
BEFORE INSERT ON pacs_settings
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id)
BEGIN
  SELECT RAISE(ABORT, 'PACS organization does not exist');
END;

CREATE TRIGGER IF NOT EXISTS pacs_settings_org_update
BEFORE UPDATE OF organization_id ON pacs_settings
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id)
BEGIN
  SELECT RAISE(ABORT, 'PACS organization does not exist');
END;
