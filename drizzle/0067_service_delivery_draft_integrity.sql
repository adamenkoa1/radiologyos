-- Draft service-delivery snapshots remain editable only while they continue to match
-- the exact completed booking facts. This closes direct-D1 tampering before posting.
CREATE TRIGGER IF NOT EXISTS `service_delivery_details_integrity_update`
BEFORE UPDATE ON `service_delivery_details`
WHEN EXISTS (
  SELECT 1 FROM `business_documents` d
  WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft'
)
BEGIN
  SELECT CASE WHEN NEW.organization_id <> OLD.organization_id OR NEW.document_id <> OLD.document_id
    THEN RAISE(ABORT,'service_delivery_document_identity_immutable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='draft'
  ) THEN RAISE(ABORT,'service_delivery_document_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `bookings` b
    WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id
      AND b.status='completed' AND b.performed_at<>''
      AND b.patient_id=NEW.patient_id
      AND b.patient_category=NEW.patient_category
      AND b.service_code=NEW.service_code
      AND b.service=NEW.service_title
      AND b.equipment_id=NEW.equipment_id
      AND b.duration_minutes=NEW.duration_minutes
      AND b.anatomical_regions_count=NEW.anatomical_regions_count
      AND b.performed_at=NEW.performed_at
      AND b.assigned_radiologist_email=NEW.radiologist_email
      AND b.assigned_radiographer_email=NEW.radiographer_email
      AND b.payment_amount=NEW.price_amount
  ) THEN RAISE(ABORT,'service_delivery_booking_snapshot_mismatch') END;
  SELECT CASE WHEN NEW.charge_amount <> CASE WHEN NEW.patient_category='civilian' THEN NEW.price_amount ELSE 0 END
    THEN RAISE(ABORT,'service_delivery_charge_mismatch') END;
END;
