-- The clinical execution transition and the economic service-delivery registrar must not diverge.
-- New completions are posted atomically by D1. Historical completed bookings are deliberately
-- left legacy/unlinked; the staff service-delivery endpoint can post them explicitly later.

CREATE TRIGGER IF NOT EXISTS `booking_service_delivery_snapshot_immutable`
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
    AND d.document_type='service_delivery' AND d.state='posted'
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
BEGIN
  SELECT RAISE(ABORT,'service_delivery_booking_immutable');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `booking_service_delivery_auto_post`
AFTER UPDATE OF `performed_at`,`status` ON `bookings`
WHEN NEW.status='completed' AND NEW.performed_at<>''
  AND NOT EXISTS (
    SELECT 1 FROM `service_delivery_details` s
    JOIN `business_documents` d ON d.id=s.document_id AND d.organization_id=s.organization_id
    WHERE s.organization_id=NEW.organization_id AND s.booking_id=NEW.id
      AND d.document_type='service_delivery' AND d.state IN ('draft','posted')
  )
BEGIN
  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,`created_by`)
  VALUES (
    NEW.organization_id,'service_delivery',printf('НП-%06d',NEW.id),NEW.performed_at,'draft',
    'Автоматично з факту виконання дослідження','system:execution'
  );

  INSERT INTO `service_delivery_details`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`patient_category`,`service_code`,`service_title`,
     `equipment_id`,`duration_minutes`,`anatomical_regions_count`,`performed_at`,`radiologist_email`,
     `radiographer_email`,`price_amount`,`charge_amount`,`currency`)
  SELECT
    NEW.organization_id,d.id,NEW.id,NEW.patient_id,NEW.patient_category,NEW.service_code,NEW.service,
    NEW.equipment_id,NEW.duration_minutes,NEW.anatomical_regions_count,NEW.performed_at,
    NEW.assigned_radiologist_email,NEW.assigned_radiographer_email,NEW.payment_amount,
    CASE WHEN NEW.patient_category='civilian' THEN NEW.payment_amount ELSE 0 END,'UAH'
  FROM `business_documents` d
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND d.number=printf('НП-%06d',NEW.id) AND d.state='draft';

  UPDATE `business_documents`
  SET state='posted',posted_by='system:execution',posted_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id AND document_type='service_delivery'
    AND number=printf('НП-%06d',NEW.id) AND state='draft';

  INSERT INTO `services_delivered_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`service_code`,`equipment_id`,`quantity`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.patient_id,NEW.service_code,NEW.equipment_id,1,
         NEW.anatomical_regions_count,NEW.performed_at,'system:execution',NEW.performed_at
  FROM `business_documents` d
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND d.number=printf('НП-%06d',NEW.id) AND d.state='posted';

  INSERT INTO `equipment_load_movements`
    (`organization_id`,`document_id`,`booking_id`,`equipment_id`,`minutes_delta`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.equipment_id,NEW.duration_minutes,NEW.performed_at,
         'system:execution',NEW.performed_at
  FROM `business_documents` d
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND d.number=printf('НП-%06d',NEW.id) AND d.state='posted';

  INSERT INTO `revenue_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`service_code`,`movement_type`,`amount_delta`,
     `currency`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.patient_id,NEW.service_code,'service_delivery',NEW.payment_amount,
         'UAH','system:execution',NEW.performed_at
  FROM `business_documents` d
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND d.number=printf('НП-%06d',NEW.id) AND d.state='posted'
    AND NEW.patient_category='civilian' AND NEW.payment_amount>0;

  INSERT INTO `patient_settlement_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`movement_type`,`amount_delta`,`currency`,
     `actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.patient_id,'charge',NEW.payment_amount,'UAH',
         'system:execution',NEW.performed_at
  FROM `business_documents` d
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND d.number=printf('НП-%06d',NEW.id) AND d.state='posted'
    AND NEW.patient_category='civilian' AND NEW.payment_amount>0;

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`member_email`,`staff_role`,`units_delta`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.assigned_radiologist_email,'radiologist',1,
         NEW.anatomical_regions_count,NEW.performed_at,'system:execution',NEW.performed_at
  FROM `business_documents` d
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND d.number=printf('НП-%06d',NEW.id) AND d.state='posted'
    AND NEW.assigned_radiologist_email<>'';

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`member_email`,`staff_role`,`units_delta`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.assigned_radiographer_email,'radiographer',1,
         NEW.anatomical_regions_count,NEW.performed_at,'system:execution',NEW.performed_at
  FROM `business_documents` d
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND d.number=printf('НП-%06d',NEW.id) AND d.state='posted'
    AND NEW.assigned_radiographer_email<>'';
END;
