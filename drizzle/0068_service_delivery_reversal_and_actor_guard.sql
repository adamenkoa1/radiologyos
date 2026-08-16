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
-- of the same tenant. Clinical actors must also be assigned to that exact booking; admin/registrar
-- keep their tenant-wide execution-recording authority from the existing API contract.
CREATE TRIGGER IF NOT EXISTS `execution_recorded_actor_guard`
BEFORE INSERT ON `booking_events`
WHEN NEW.action='execution_recorded'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `memberships` m
    JOIN `staff_members` s ON s.email=m.member_email AND s.active=1
    JOIN `bookings` b ON b.id=NEW.booking_id AND b.organization_id=NEW.organization_id
    WHERE m.organization_id=NEW.organization_id AND m.member_email=NEW.actor AND m.active=1
      AND (
        m.role IN ('admin','registrar')
        OR (m.role='radiologist' AND b.assigned_radiologist_email=NEW.actor)
        OR (m.role='radiographer' AND b.assigned_radiographer_email=NEW.actor)
      )
  ) THEN RAISE(ABORT,'execution_recorded_actor_invalid') END;
END;
--> statement-breakpoint

-- A service Act detail cannot be manufactured independently of the explicit execution event.
-- The posted document's author must be the actor of an execution_recorded event for this exact booking/tenant.
CREATE TRIGGER IF NOT EXISTS `service_delivery_requires_execution_event`
BEFORE INSERT ON `service_delivery_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `booking_events` e
      ON e.organization_id=d.organization_id AND e.booking_id=NEW.booking_id
     AND e.action='execution_recorded' AND e.actor=d.created_by
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='posted'
  ) THEN RAISE(ABORT,'service_delivery_execution_event_missing') END;
END;