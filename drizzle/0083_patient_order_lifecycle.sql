-- Patient Order lifecycle: booking cancellation must respect immutable economic facts.
-- Draft orders close together with their booking. Posted orders remain historical roots;
-- payments/services must be corrected through refund/storno before the booking may be cancelled.

-- One deterministic booking-cancel guard. It applies to legacy bookings too for active economic facts,
-- while Patient Order-specific draft descendants are checked only when an order exists.
CREATE TRIGGER IF NOT EXISTS `booking_cancel_economic_facts_guard`
BEFORE UPDATE OF `status` ON `bookings`
WHEN OLD.status <> 'cancelled' AND NEW.status = 'cancelled'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `payment_transactions` p
    WHERE p.organization_id=OLD.organization_id AND p.booking_id=OLD.id AND p.status='paid'
  ) THEN RAISE(ABORT,'booking_cancel_payment_refund_required') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `service_delivery_details` s
    JOIN `business_documents` d
      ON d.id=s.document_id AND d.organization_id=s.organization_id
    WHERE s.organization_id=OLD.organization_id AND s.booking_id=OLD.id
      AND d.document_type='service_delivery' AND d.state='posted'
  ) THEN RAISE(ABORT,'booking_cancel_service_storno_required') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `patient_order_details` o
    JOIN `business_documents` child
      ON child.organization_id=o.organization_id AND child.basis_document_id=o.document_id
    WHERE o.organization_id=OLD.organization_id AND o.booking_id=OLD.id
      AND child.state='draft'
      AND child.document_type IN ('payment','service_delivery')
  ) THEN RAISE(ABORT,'booking_cancel_downstream_draft_exists') END;
END;
--> statement-breakpoint

-- Closing an operational booking closes only its still-draft commercial root.
-- A posted Patient Order is evidence and is intentionally preserved as posted.
CREATE TRIGGER IF NOT EXISTS `booking_cancel_closes_draft_patient_order`
AFTER UPDATE OF `status` ON `bookings`
WHEN OLD.status <> 'cancelled' AND NEW.status = 'cancelled'
BEGIN
  UPDATE `business_documents`
  SET state='cancelled'
  WHERE organization_id=NEW.organization_id
    AND document_type='patient_order'
    AND state='draft'
    AND id=(
      SELECT o.document_id
      FROM `patient_order_details` o
      WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.id
      LIMIT 1
    );
END;
--> statement-breakpoint

-- The commercial root cannot be cancelled independently from the operational booking.
CREATE TRIGGER IF NOT EXISTS `patient_order_cancel_requires_booking_cancelled`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='patient_order' AND OLD.state='draft' AND NEW.state='cancelled'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `patient_order_details` o
    JOIN `bookings` b ON b.id=o.booking_id AND b.organization_id=o.organization_id
    WHERE o.document_id=OLD.id AND o.organization_id=OLD.organization_id
      AND b.status='cancelled'
  ) THEN RAISE(ABORT,'patient_order_cancel_requires_booking_cancelled') END;
END;
--> statement-breakpoint

-- A cancelled business document may never become a new document basis. This prevents a cancelled
-- Patient Order from later acquiring a payment/service-delivery through a stale UI or direct SQL.
CREATE TRIGGER IF NOT EXISTS `business_document_cancelled_basis_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.basis_document_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id AND src.state='cancelled'
  )
BEGIN SELECT RAISE(ABORT,'business_document_basis_cancelled'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `business_document_cancelled_basis_update`
BEFORE UPDATE OF `basis_document_id`,`organization_id` ON `business_documents`
WHEN NEW.basis_document_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id AND src.state='cancelled'
  )
BEGIN SELECT RAISE(ABORT,'business_document_basis_cancelled'); END;
--> statement-breakpoint

-- A reversed service source remains immutable after storno, except for the final operational
-- completed -> cancelled transition once the cancellation guard confirms that no live economic fact remains.
DROP TRIGGER IF EXISTS `booking_reversed_service_snapshot_immutable`;
--> statement-breakpoint
CREATE TRIGGER `booking_reversed_service_snapshot_immutable`
BEFORE UPDATE OF
  `patient_id`,`patient_category`,`service`,`service_code`,`equipment_id`,`duration_minutes`,
  `anatomical_regions_count`,`performed_at`,`assigned_radiologist_email`,`assigned_radiographer_email`,
  `payment_amount`,`status`
ON `bookings`
WHEN EXISTS (
  SELECT 1
  FROM `service_delivery_details` s
  JOIN `business_documents` d ON d.id=s.document_id AND d.organization_id=s.organization_id
  WHERE s.organization_id=OLD.organization_id AND s.booking_id=OLD.id
    AND d.document_type='service_delivery' AND d.state='reversed'
)
AND (
  NEW.organization_id IS NOT OLD.organization_id
  OR NEW.patient_id IS NOT OLD.patient_id
  OR NEW.patient_category IS NOT OLD.patient_category
  OR NEW.service IS NOT OLD.service
  OR NEW.service_code IS NOT OLD.service_code
  OR NEW.equipment_id IS NOT OLD.equipment_id
  OR NEW.duration_minutes IS NOT OLD.duration_minutes
  OR NEW.anatomical_regions_count IS NOT OLD.anatomical_regions_count
  OR NEW.performed_at IS NOT OLD.performed_at
  OR NEW.assigned_radiologist_email IS NOT OLD.assigned_radiologist_email
  OR NEW.assigned_radiographer_email IS NOT OLD.assigned_radiographer_email
  OR NEW.payment_amount IS NOT OLD.payment_amount
  OR NEW.status IS NOT OLD.status
)
AND NOT (
  OLD.status='completed' AND NEW.status='cancelled'
  AND NEW.organization_id IS OLD.organization_id
  AND NEW.patient_id IS OLD.patient_id
  AND NEW.patient_category IS OLD.patient_category
  AND NEW.service IS OLD.service
  AND NEW.service_code IS OLD.service_code
  AND NEW.equipment_id IS OLD.equipment_id
  AND NEW.duration_minutes IS OLD.duration_minutes
  AND NEW.anatomical_regions_count IS OLD.anatomical_regions_count
  AND NEW.performed_at IS OLD.performed_at
  AND NEW.assigned_radiologist_email IS OLD.assigned_radiologist_email
  AND NEW.assigned_radiographer_email IS OLD.assigned_radiographer_email
  AND NEW.payment_amount IS OLD.payment_amount
)
BEGIN SELECT RAISE(ABORT,'service_delivery_booking_immutable'); END;
