-- Separate clinical signing from patient delivery.
-- `signed` means the clinical document is finalized by a radiologist.
-- `issued` remains the patient-delivery state. Signed clinical content is
-- physically immutable in D1; only signed -> issued may change the status.

ALTER TABLE `protocols` ADD COLUMN `signed_by` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN `signed_at` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN `signed_version` integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Existing issued documents predate explicit signing. Preserve delivery and
-- mark the inferred historical signature truthfully instead of attributing it
-- to a clinician whose signing action was never recorded.
UPDATE `protocols`
SET `signed_by` = 'system:legacy-issued',
    `signed_at` = CASE WHEN `updated_at` != '' THEN `updated_at` ELSE `created_at` END,
    `signed_version` = `version`
WHERE `status` = 'issued' AND `signed_at` = '';
--> statement-breakpoint

INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
SELECT organization_id, booking_id, 'protocol_signature_migrated',
       'legacy issued protocol · v' || version,
       'system:migration-0049'
FROM protocols
WHERE status = 'issued' AND signed_by = 'system:legacy-issued';
--> statement-breakpoint

-- Replace the 0044 projection triggers so `signed` projects to legacy `ready`.
DROP TRIGGER IF EXISTS protocols_project_booking_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS protocols_project_booking_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS bookings_protocol_projection_guard;
--> statement-breakpoint

CREATE TRIGGER protocols_project_booking_insert
AFTER INSERT ON protocols
FOR EACH ROW
BEGIN
  UPDATE bookings
  SET protocol_number = NEW.number,
      protocol_status = CASE NEW.status
        WHEN 'draft' THEN 'in_progress'
        WHEN 'ready' THEN 'ready'
        WHEN 'signed' THEN 'ready'
        WHEN 'issued' THEN 'issued'
        ELSE 'not_started'
      END,
      protocol_updated_at = CURRENT_TIMESTAMP,
      protocol_ready_at = CASE
        WHEN NEW.status IN ('ready','signed','issued') AND protocol_ready_at = '' THEN CURRENT_TIMESTAMP
        ELSE protocol_ready_at
      END,
      protocol_issued_at = CASE
        WHEN NEW.status = 'issued' AND protocol_issued_at = '' THEN CURRENT_TIMESTAMP
        ELSE protocol_issued_at
      END
  WHERE id = NEW.booking_id AND organization_id = NEW.organization_id;
END;
--> statement-breakpoint

CREATE TRIGGER protocols_project_booking_update
AFTER UPDATE OF number, status ON protocols
FOR EACH ROW
BEGIN
  UPDATE bookings
  SET protocol_number = NEW.number,
      protocol_status = CASE NEW.status
        WHEN 'draft' THEN 'in_progress'
        WHEN 'ready' THEN 'ready'
        WHEN 'signed' THEN 'ready'
        WHEN 'issued' THEN 'issued'
        ELSE 'not_started'
      END,
      protocol_updated_at = CURRENT_TIMESTAMP,
      protocol_ready_at = CASE
        WHEN NEW.status IN ('ready','signed','issued') AND protocol_ready_at = '' THEN CURRENT_TIMESTAMP
        ELSE protocol_ready_at
      END,
      protocol_issued_at = CASE
        WHEN NEW.status = 'issued' AND protocol_issued_at = '' THEN CURRENT_TIMESTAMP
        ELSE protocol_issued_at
      END
  WHERE id = NEW.booking_id AND organization_id = NEW.organization_id;
END;
--> statement-breakpoint

CREATE TRIGGER bookings_protocol_projection_guard
BEFORE UPDATE OF protocol_status, protocol_number ON bookings
FOR EACH ROW
WHEN NEW.protocol_status != COALESCE((
       SELECT CASE p.status
         WHEN 'draft' THEN 'in_progress'
         WHEN 'ready' THEN 'ready'
         WHEN 'signed' THEN 'ready'
         WHEN 'issued' THEN 'issued'
         ELSE 'not_started'
       END
       FROM protocols p
       WHERE p.booking_id = NEW.id AND p.organization_id = NEW.organization_id
     ), 'not_started')
  OR NEW.protocol_number != COALESCE((
       SELECT p.number
       FROM protocols p
       WHERE p.booking_id = NEW.id AND p.organization_id = NEW.organization_id
     ), '')
BEGIN
  SELECT RAISE(ABORT, 'booking protocol projection mismatch');
END;
--> statement-breakpoint

-- Signature metadata and state must agree. Draft/ready documents cannot carry a
-- signature, while signed/issued documents must bind the signature to the exact
-- current clinical version.
CREATE TRIGGER protocols_signature_state_guard_insert
BEFORE INSERT ON protocols
FOR EACH ROW
WHEN (
    NEW.status IN ('signed','issued') AND
      (NEW.signed_by = '' OR NEW.signed_at = '' OR NEW.signed_version != NEW.version)
  ) OR (
    NEW.status NOT IN ('signed','issued') AND
      (NEW.signed_by != '' OR NEW.signed_at != '' OR NEW.signed_version != 0)
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol signature state mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER protocols_signature_state_guard_update
BEFORE UPDATE ON protocols
FOR EACH ROW
WHEN (
    NEW.status IN ('signed','issued') AND
      (NEW.signed_by = '' OR NEW.signed_at = '' OR NEW.signed_version != NEW.version)
  ) OR (
    NEW.status NOT IN ('signed','issued') AND
      (NEW.signed_by != '' OR NEW.signed_at != '' OR NEW.signed_version != 0)
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol signature state mismatch');
END;
--> statement-breakpoint

-- Once signed, the clinical payload, number, author, version and signature are
-- immutable. Delivery may only move status signed -> issued.
CREATE TRIGGER protocols_signed_content_immutable
BEFORE UPDATE ON protocols
FOR EACH ROW
WHEN OLD.status IN ('signed','issued') AND (
     NEW.template_key IS NOT OLD.template_key
  OR NEW.method IS NOT OLD.method
  OR NEW.sections_json IS NOT OLD.sections_json
  OR NEW.findings IS NOT OLD.findings
  OR NEW.conclusion IS NOT OLD.conclusion
  OR NEW.recommendations IS NOT OLD.recommendations
  OR NEW.number IS NOT OLD.number
  OR NEW.version IS NOT OLD.version
  OR NEW.author_email IS NOT OLD.author_email
  OR NEW.signed_by IS NOT OLD.signed_by
  OR NEW.signed_at IS NOT OLD.signed_at
  OR NEW.signed_version IS NOT OLD.signed_version
)
BEGIN
  SELECT RAISE(ABORT, 'signed protocol content is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER protocols_signed_status_guard
BEFORE UPDATE OF status ON protocols
FOR EACH ROW
WHEN (OLD.status = 'signed' AND NEW.status NOT IN ('signed','issued'))
   OR (OLD.status = 'issued' AND NEW.status != 'issued')
BEGIN
  SELECT RAISE(ABORT, 'signed protocol status is immutable');
END;
