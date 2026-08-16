-- Patient Order protects commercial terms after payment and before service execution.
-- Once a service-delivery registrar exists, its stricter execution snapshot guard owns those facts.
DROP TRIGGER IF EXISTS `booking_posted_patient_order_terms_immutable`;
--> statement-breakpoint
CREATE TRIGGER `booking_posted_patient_order_terms_immutable`
BEFORE UPDATE OF `patient_category`,`service`,`service_code`,`equipment_id`,`duration_minutes`,`payment_amount`
ON `bookings`
WHEN EXISTS (
  SELECT 1 FROM patient_order_details o
  JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
  WHERE o.organization_id=OLD.organization_id AND o.booking_id=OLD.id AND d.state='posted'
)
AND NOT EXISTS (
  SELECT 1 FROM service_delivery_details s
  JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id
  WHERE s.organization_id=OLD.organization_id AND s.booking_id=OLD.id
    AND d.document_type='service_delivery' AND d.state IN ('posted','reversed')
)
AND (
  NEW.organization_id IS NOT OLD.organization_id
  OR NEW.patient_category IS NOT OLD.patient_category
  OR NEW.service IS NOT OLD.service
  OR NEW.service_code IS NOT OLD.service_code
  OR NEW.equipment_id IS NOT OLD.equipment_id
  OR NEW.duration_minutes IS NOT OLD.duration_minutes
  OR NEW.payment_amount IS NOT OLD.payment_amount
)
BEGIN SELECT RAISE(ABORT,'patient_order_booking_terms_immutable'); END;
