-- Harden service storno into one D1 posting boundary.
-- Reversing the original posted service is the posting action: D1 requires an exact draft correction,
-- posts that correction, and writes every negative register movement in the same SQLite transaction.

CREATE TRIGGER IF NOT EXISTS `service_delivery_reverse_requires_correction`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.state='posted' AND NEW.state='reversed' AND OLD.document_type='service_delivery'
  AND EXISTS (
    SELECT 1 FROM `service_delivery_details` s
    WHERE s.document_id=OLD.id AND s.organization_id=OLD.organization_id
  )
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `service_correction_details` c
    JOIN `business_documents` d
      ON d.id=c.document_id AND d.organization_id=c.organization_id
    WHERE c.organization_id=OLD.organization_id AND c.source_document_id=OLD.id
      AND d.document_type='service_delivery' AND d.state='draft'
      AND d.reversed_document_id=OLD.id
  ) THEN RAISE(ABORT,'service_delivery_reversal_requires_correction') END;
END;
--> statement-breakpoint

-- A correction document cannot be posted independently. It is posted only from the AFTER trigger
-- of the source transition, where the source row is already visible as reversed.
CREATE TRIGGER IF NOT EXISTS `service_correction_post_requires_reversed_source`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.state='draft' AND NEW.state='posted'
  AND EXISTS (
    SELECT 1 FROM `service_correction_details` c
    WHERE c.document_id=OLD.id AND c.organization_id=OLD.organization_id
  )
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `service_correction_details` c
    JOIN `business_documents` src
      ON src.id=c.source_document_id AND src.organization_id=c.organization_id
    WHERE c.document_id=OLD.id AND c.organization_id=OLD.organization_id
      AND OLD.reversed_document_id=src.id AND src.state='reversed'
  ) THEN RAISE(ABORT,'service_correction_requires_reversed_source') END;
END;
--> statement-breakpoint

-- A negative movement is valid only after the exact source service has actually entered reversed state.
CREATE TRIGGER IF NOT EXISTS `revenue_correction_requires_reversed_source`
BEFORE INSERT ON `revenue_movements`
WHEN NEW.movement_type='service_correction'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `service_correction_details` c
    JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
    JOIN `business_documents` src ON src.id=c.source_document_id AND src.organization_id=c.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
      AND src.state='reversed' AND d.reversed_document_id=src.id
      AND c.booking_id=NEW.booking_id AND c.patient_id=NEW.patient_id
      AND c.service_code=NEW.service_code AND c.currency=NEW.currency
      AND NEW.amount_delta=-c.charge_amount AND c.charge_amount>0
  ) THEN RAISE(ABORT,'service_correction_source_not_reversed') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `equipment_correction_requires_reversed_source`
BEFORE INSERT ON `equipment_load_movements`
WHEN NEW.minutes_delta<0
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `service_correction_details` c
    JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
    JOIN `business_documents` src ON src.id=c.source_document_id AND src.organization_id=c.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
      AND src.state='reversed' AND d.reversed_document_id=src.id
      AND c.booking_id=NEW.booking_id AND c.equipment_id=NEW.equipment_id
      AND NEW.minutes_delta=-c.duration_minutes AND c.performed_at=NEW.performed_at
  ) THEN RAISE(ABORT,'service_correction_source_not_reversed') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_correction_requires_reversed_source`
BEFORE INSERT ON `staff_output_movements`
WHEN NEW.units_delta<0
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `service_correction_details` c
    JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
    JOIN `business_documents` src ON src.id=c.source_document_id AND src.organization_id=c.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
      AND src.state='reversed' AND d.reversed_document_id=src.id
      AND c.booking_id=NEW.booking_id AND NEW.units_delta=-1
      AND c.anatomical_regions_count=NEW.anatomical_regions_count AND c.performed_at=NEW.performed_at
      AND (
        (NEW.staff_role='radiologist' AND NEW.member_email=c.radiologist_email AND NEW.member_email<>'')
        OR
        (NEW.staff_role='radiographer' AND NEW.member_email=c.radiographer_email AND NEW.member_email<>'')
      )
  ) THEN RAISE(ABORT,'service_correction_source_not_reversed') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `settlement_correction_requires_reversed_source`
BEFORE INSERT ON `patient_settlement_movements`
WHEN NEW.movement_type='adjustment' AND NEW.amount_delta<0
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `service_correction_details` c
    JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
    JOIN `business_documents` src ON src.id=c.source_document_id AND src.organization_id=c.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
      AND src.state='reversed' AND d.reversed_document_id=src.id
      AND c.booking_id=NEW.booking_id AND c.patient_id=NEW.patient_id AND c.currency=NEW.currency
      AND NEW.amount_delta=-c.charge_amount AND c.charge_amount>0
  ) THEN RAISE(ABORT,'service_correction_source_not_reversed') END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `service_delivery_reverse_posts_correction`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.state='posted' AND NEW.state='reversed' AND OLD.document_type='service_delivery'
  AND EXISTS (
    SELECT 1 FROM `service_delivery_details` s
    WHERE s.document_id=NEW.id AND s.organization_id=NEW.organization_id
  )
BEGIN
  UPDATE `business_documents`
  SET state='posted',posted_by=created_by,posted_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id AND document_type='service_delivery' AND state='draft'
    AND id=(
      SELECT c.document_id FROM `service_correction_details` c
      WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id
      LIMIT 1
    );

  INSERT INTO `service_correction_movements`
    (`organization_id`,`document_id`,`source_document_id`,`booking_id`,`patient_id`,`service_code`,`equipment_id`,
     `quantity_delta`,`anatomical_regions_delta`,`reason`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,c.document_id,c.source_document_id,c.booking_id,c.patient_id,c.service_code,c.equipment_id,
         -1,-c.anatomical_regions_count,c.reason,d.created_by,d.occurred_at
  FROM `service_correction_details` c
  JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id AND d.state='posted';

  INSERT INTO `equipment_load_movements`
    (`organization_id`,`document_id`,`booking_id`,`equipment_id`,`minutes_delta`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,c.document_id,c.booking_id,c.equipment_id,-c.duration_minutes,c.performed_at,d.created_by,d.occurred_at
  FROM `service_correction_details` c
  JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id AND d.state='posted';

  INSERT INTO `revenue_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`service_code`,`movement_type`,`amount_delta`,`currency`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,c.document_id,c.booking_id,c.patient_id,c.service_code,'service_correction',-c.charge_amount,
         c.currency,d.created_by,d.occurred_at
  FROM `service_correction_details` c
  JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id
    AND d.state='posted' AND c.charge_amount>0;

  INSERT INTO `patient_settlement_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`movement_type`,`amount_delta`,`currency`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,c.document_id,c.booking_id,c.patient_id,'adjustment',-c.charge_amount,
         c.currency,d.created_by,d.occurred_at
  FROM `service_correction_details` c
  JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id
    AND d.state='posted' AND c.charge_amount>0;

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`member_email`,`staff_role`,`units_delta`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,c.document_id,c.booking_id,c.radiologist_email,'radiologist',-1,
         c.anatomical_regions_count,c.performed_at,d.created_by,d.occurred_at
  FROM `service_correction_details` c
  JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id
    AND d.state='posted' AND c.radiologist_email<>'';

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`member_email`,`staff_role`,`units_delta`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,c.document_id,c.booking_id,c.radiographer_email,'radiographer',-1,
         c.anatomical_regions_count,c.performed_at,d.created_by,d.occurred_at
  FROM `service_correction_details` c
  JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id
    AND d.state='posted' AND c.radiographer_email<>'';
END;
