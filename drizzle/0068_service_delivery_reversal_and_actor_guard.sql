-- Until explicit service correction/storno movements exist, a posted service Act cannot be marked reversed.
-- Otherwise the document state could diverge from append-only revenue/workload/output movements.
CREATE TRIGGER IF NOT EXISTS `service_delivery_direct_reversal_blocked`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='service_delivery' AND OLD.state='posted' AND NEW.state='reversed'
BEGIN
  SELECT RAISE(ABORT,'service_delivery_requires_correction_document');
END;
--> statement-breakpoint

-- `execution_recorded` is the medical-to-business bridge. Its actor must be an active staff member
-- of the same tenant with one of the existing roles that may record execution facts.
CREATE TRIGGER IF NOT EXISTS `execution_recorded_actor_guard`
BEFORE INSERT ON `booking_events`
WHEN NEW.action='execution_recorded'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `memberships` m
    JOIN `staff_members` s ON s.email=m.member_email AND s.active=1
    WHERE m.organization_id=NEW.organization_id AND m.member_email=NEW.actor AND m.active=1
      AND m.role IN ('admin','registrar','radiologist','radiographer')
  ) THEN RAISE(ABORT,'execution_recorded_actor_invalid') END;
END;