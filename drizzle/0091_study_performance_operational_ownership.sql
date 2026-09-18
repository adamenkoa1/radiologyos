-- Split the operational fact of a performed study from the economic service-delivery registrar.
-- New positive study/service, equipment-load and staff-output movements are owned by the linked
-- study_performance document. Revenue and patient settlements remain owned by service_delivery.
-- Historical rows are deliberately not rewritten; legacy storno remains valid when no performance
-- registrar exists, while any linked performance must be reversed before negative operational moves.

-- New positive performed-study movements must be owned by study_performance, not service_delivery.
DROP TRIGGER IF EXISTS `services_delivered_integrity_insert`;
--> statement-breakpoint
CREATE TRIGGER `services_delivered_integrity_insert`
BEFORE INSERT ON `services_delivered_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` p
    JOIN `business_documents` src
      ON src.id=p.basis_document_id AND src.organization_id=p.organization_id
    JOIN `service_delivery_details` s
      ON s.document_id=src.id AND s.organization_id=src.organization_id
    WHERE p.id=NEW.document_id AND p.organization_id=NEW.organization_id
      AND p.document_type='study_performance' AND p.state='posted'
      AND src.document_type='service_delivery' AND src.state='posted'
      AND s.booking_id=NEW.booking_id AND s.patient_id=NEW.patient_id
      AND s.service_code=NEW.service_code AND s.equipment_id=NEW.equipment_id
      AND NEW.quantity=1 AND s.anatomical_regions_count=NEW.anatomical_regions_count
      AND s.performed_at=NEW.performed_at
      AND NEW.actor_email=p.posted_by AND NEW.occurred_at=p.occurred_at
  ) THEN RAISE(ABORT,'services_delivered_performance_mismatch') END;
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS `equipment_load_integrity_insert`;
--> statement-breakpoint
CREATE TRIGGER `equipment_load_integrity_insert`
BEFORE INSERT ON `equipment_load_movements`
BEGIN
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1
      FROM `business_documents` p
      JOIN `business_documents` src
        ON src.id=p.basis_document_id AND src.organization_id=p.organization_id
      JOIN `service_delivery_details` s
        ON s.document_id=src.id AND s.organization_id=src.organization_id
      WHERE p.id=NEW.document_id AND p.organization_id=NEW.organization_id
        AND p.document_type='study_performance' AND p.state='posted'
        AND src.document_type='service_delivery' AND src.state='posted'
        AND s.booking_id=NEW.booking_id AND s.equipment_id=NEW.equipment_id
        AND NEW.minutes_delta=s.duration_minutes AND s.performed_at=NEW.performed_at
        AND NEW.actor_email=p.posted_by AND NEW.occurred_at=p.occurred_at
    )
    OR
    EXISTS (
      SELECT 1
      FROM `business_documents` d
      JOIN `service_correction_details` c
        ON c.document_id=d.id AND c.organization_id=d.organization_id
      JOIN `business_documents` src
        ON src.id=c.source_document_id AND src.organization_id=c.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='service_delivery' AND d.state='posted'
        AND d.reversed_document_id=c.source_document_id
        AND src.document_type='service_delivery' AND src.state='reversed'
        AND c.booking_id=NEW.booking_id AND c.equipment_id=NEW.equipment_id
        AND NEW.minutes_delta=-c.duration_minutes AND c.performed_at=NEW.performed_at
        AND (
          NOT EXISTS (
            SELECT 1 FROM `business_documents` p0
            WHERE p0.organization_id=c.organization_id
              AND p0.document_type='study_performance' AND p0.basis_document_id=c.source_document_id
          )
          OR EXISTS (
            SELECT 1 FROM `business_documents` p
            WHERE p.organization_id=c.organization_id
              AND p.document_type='study_performance' AND p.basis_document_id=c.source_document_id
              AND p.state='reversed'
          )
        )
    )
  ) THEN RAISE(ABORT,'equipment_load_document_mismatch') END;
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS `staff_output_integrity_insert`;
--> statement-breakpoint
CREATE TRIGGER `staff_output_integrity_insert`
BEFORE INSERT ON `staff_output_movements`
BEGIN
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1
      FROM `business_documents` p
      JOIN `business_documents` src
        ON src.id=p.basis_document_id AND src.organization_id=p.organization_id
      JOIN `service_delivery_details` s
        ON s.document_id=src.id AND s.organization_id=src.organization_id
      WHERE p.id=NEW.document_id AND p.organization_id=NEW.organization_id
        AND p.document_type='study_performance' AND p.state='posted'
        AND src.document_type='service_delivery' AND src.state='posted'
        AND s.booking_id=NEW.booking_id AND s.performed_at=NEW.performed_at
        AND s.anatomical_regions_count=NEW.anatomical_regions_count AND NEW.units_delta=1
        AND NEW.actor_email=p.posted_by AND NEW.occurred_at=p.occurred_at
        AND (
          (NEW.staff_role='radiologist' AND NEW.member_email<>'' AND NEW.member_email=s.radiologist_email)
          OR
          (NEW.staff_role='radiographer' AND NEW.member_email<>'' AND NEW.member_email=s.radiographer_email)
        )
    )
    OR
    EXISTS (
      SELECT 1
      FROM `business_documents` d
      JOIN `service_correction_details` c
        ON c.document_id=d.id AND c.organization_id=d.organization_id
      JOIN `business_documents` src
        ON src.id=c.source_document_id AND src.organization_id=c.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='service_delivery' AND d.state='posted'
        AND d.reversed_document_id=c.source_document_id
        AND src.document_type='service_delivery' AND src.state='reversed'
        AND c.booking_id=NEW.booking_id AND c.performed_at=NEW.performed_at
        AND c.anatomical_regions_count=NEW.anatomical_regions_count AND NEW.units_delta=-1
        AND (
          (NEW.staff_role='radiologist' AND NEW.member_email<>'' AND NEW.member_email=c.radiologist_email)
          OR
          (NEW.staff_role='radiographer' AND NEW.member_email<>'' AND NEW.member_email=c.radiographer_email)
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM `business_documents` p0
            WHERE p0.organization_id=c.organization_id
              AND p0.document_type='study_performance' AND p0.basis_document_id=c.source_document_id
          )
          OR EXISTS (
            SELECT 1 FROM `business_documents` p
            WHERE p.organization_id=c.organization_id
              AND p.document_type='study_performance' AND p.basis_document_id=c.source_document_id
              AND p.state='reversed'
          )
        )
    )
  ) THEN RAISE(ABORT,'staff_output_document_mismatch') END;
END;
--> statement-breakpoint

-- The performed-study correction register must also be tied to the reversed operational fact when one exists.
DROP TRIGGER IF EXISTS `service_correction_movement_integrity`;
--> statement-breakpoint
CREATE TRIGGER `service_correction_movement_integrity`
BEFORE INSERT ON `service_correction_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `service_correction_details` c
      ON c.document_id=d.id AND c.organization_id=d.organization_id
    JOIN `business_documents` src
      ON src.id=c.source_document_id AND src.organization_id=c.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='posted'
      AND d.reversed_document_id=c.source_document_id
      AND src.document_type='service_delivery' AND src.state='reversed'
      AND c.source_document_id=NEW.source_document_id
      AND c.booking_id=NEW.booking_id
      AND c.patient_id=NEW.patient_id
      AND c.service_code=NEW.service_code
      AND c.equipment_id=NEW.equipment_id
      AND NEW.quantity_delta=-1
      AND NEW.anatomical_regions_delta=-c.anatomical_regions_count
      AND NEW.reason=c.reason
      AND (
        NOT EXISTS (
          SELECT 1 FROM `business_documents` p0
          WHERE p0.organization_id=c.organization_id
            AND p0.document_type='study_performance' AND p0.basis_document_id=c.source_document_id
        )
        OR EXISTS (
          SELECT 1 FROM `business_documents` p
          WHERE p.organization_id=c.organization_id
            AND p.document_type='study_performance' AND p.basis_document_id=c.source_document_id
            AND p.state='reversed'
        )
      )
  ) THEN RAISE(ABORT,'service_correction_movement_mismatch') END;
END;
--> statement-breakpoint

-- Posting a correction requires the source economic fact to be reversed and, for post-0090 facts,
-- the linked study_performance registrar to be reversed as well. Legacy sources without one stay valid.
DROP TRIGGER IF EXISTS `service_correction_post_requires_reversed_source`;
--> statement-breakpoint
CREATE TRIGGER `service_correction_post_requires_reversed_source`
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
      AND (
        NOT EXISTS (
          SELECT 1 FROM `business_documents` p0
          WHERE p0.organization_id=c.organization_id
            AND p0.document_type='study_performance' AND p0.basis_document_id=src.id
        )
        OR EXISTS (
          SELECT 1 FROM `business_documents` p
          WHERE p.organization_id=c.organization_id
            AND p.document_type='study_performance' AND p.basis_document_id=src.id
            AND p.state='reversed'
        )
      )
  ) THEN RAISE(ABORT,'service_correction_requires_reversed_source') END;
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS `equipment_correction_requires_reversed_source`;
--> statement-breakpoint
CREATE TRIGGER `equipment_correction_requires_reversed_source`
BEFORE INSERT ON `equipment_load_movements`
WHEN NEW.minutes_delta<0
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `service_correction_details` c
    JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
    JOIN `business_documents` src ON src.id=c.source_document_id AND src.organization_id=c.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
      AND src.state='reversed' AND d.reversed_document_id=src.id
      AND c.booking_id=NEW.booking_id AND c.equipment_id=NEW.equipment_id
      AND NEW.minutes_delta=-c.duration_minutes AND c.performed_at=NEW.performed_at
      AND (
        NOT EXISTS (
          SELECT 1 FROM `business_documents` p0
          WHERE p0.organization_id=c.organization_id
            AND p0.document_type='study_performance' AND p0.basis_document_id=src.id
        )
        OR EXISTS (
          SELECT 1 FROM `business_documents` p
          WHERE p.organization_id=c.organization_id
            AND p.document_type='study_performance' AND p.basis_document_id=src.id
            AND p.state='reversed'
        )
      )
  ) THEN RAISE(ABORT,'service_correction_source_not_reversed') END;
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS `staff_correction_requires_reversed_source`;
--> statement-breakpoint
CREATE TRIGGER `staff_correction_requires_reversed_source`
BEFORE INSERT ON `staff_output_movements`
WHEN NEW.units_delta<0
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `service_correction_details` c
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
      AND (
        NOT EXISTS (
          SELECT 1 FROM `business_documents` p0
          WHERE p0.organization_id=c.organization_id
            AND p0.document_type='study_performance' AND p0.basis_document_id=src.id
        )
        OR EXISTS (
          SELECT 1 FROM `business_documents` p
          WHERE p.organization_id=c.organization_id
            AND p.document_type='study_performance' AND p.basis_document_id=src.id
            AND p.state='reversed'
        )
      )
  ) THEN RAISE(ABORT,'service_correction_source_not_reversed') END;
END;
--> statement-breakpoint

-- A newly inserted posted study_performance registrar is now the only positive operational owner.
CREATE TRIGGER IF NOT EXISTS `study_performance_operational_post`
AFTER INSERT ON `business_documents`
WHEN NEW.document_type='study_performance' AND NEW.state='posted'
BEGIN
  INSERT INTO `services_delivered_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`service_code`,`equipment_id`,`quantity`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT s.organization_id,NEW.id,s.booking_id,s.patient_id,s.service_code,s.equipment_id,1,
         s.anatomical_regions_count,s.performed_at,NEW.posted_by,NEW.occurred_at
  FROM `service_delivery_details` s
  JOIN `business_documents` src ON src.id=s.document_id AND src.organization_id=s.organization_id
  WHERE s.organization_id=NEW.organization_id AND s.document_id=NEW.basis_document_id
    AND src.document_type='service_delivery' AND src.state='posted';

  INSERT INTO `equipment_load_movements`
    (`organization_id`,`document_id`,`booking_id`,`equipment_id`,`minutes_delta`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT s.organization_id,NEW.id,s.booking_id,s.equipment_id,s.duration_minutes,s.performed_at,
         NEW.posted_by,NEW.occurred_at
  FROM `service_delivery_details` s
  JOIN `business_documents` src ON src.id=s.document_id AND src.organization_id=s.organization_id
  WHERE s.organization_id=NEW.organization_id AND s.document_id=NEW.basis_document_id
    AND src.document_type='service_delivery' AND src.state='posted';

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`member_email`,`staff_role`,`units_delta`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT s.organization_id,NEW.id,s.booking_id,s.radiologist_email,'radiologist',1,
         s.anatomical_regions_count,s.performed_at,NEW.posted_by,NEW.occurred_at
  FROM `service_delivery_details` s
  JOIN `business_documents` src ON src.id=s.document_id AND src.organization_id=s.organization_id
  WHERE s.organization_id=NEW.organization_id AND s.document_id=NEW.basis_document_id
    AND src.document_type='service_delivery' AND src.state='posted'
    AND s.radiologist_email<>'';

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`member_email`,`staff_role`,`units_delta`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT s.organization_id,NEW.id,s.booking_id,s.radiographer_email,'radiographer',1,
         s.anatomical_regions_count,s.performed_at,NEW.posted_by,NEW.occurred_at
  FROM `service_delivery_details` s
  JOIN `business_documents` src ON src.id=s.document_id AND src.organization_id=s.organization_id
  WHERE s.organization_id=NEW.organization_id AND s.document_id=NEW.basis_document_id
    AND src.document_type='service_delivery' AND src.state='posted'
    AND s.radiographer_email<>'';
END;
--> statement-breakpoint

-- Automatic completion still creates/posts service_delivery atomically, but only its economic movements
-- remain here. The nested service_delivery posting transition creates study_performance, whose INSERT trigger
-- writes the positive operational movements before this trigger resumes.
DROP TRIGGER IF EXISTS `booking_service_delivery_auto_post`;
--> statement-breakpoint
CREATE TRIGGER `booking_service_delivery_auto_post`
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
    NEW.organization_id,'service_delivery','',NEW.performed_at,'draft',
    'Автоматично з факту виконання дослідження','system:execution'
  );

  UPDATE `business_documents`
  SET number=printf('НП-%06d',id)
  WHERE id=last_insert_rowid() AND organization_id=NEW.organization_id
    AND document_type='service_delivery' AND state='draft' AND number='';

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
  WHERE d.id=last_insert_rowid() AND d.organization_id=NEW.organization_id
    AND d.document_type='service_delivery' AND d.state='draft';

  UPDATE `business_documents`
  SET state='posted',posted_by='system:execution',posted_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id AND document_type='service_delivery' AND state='draft'
    AND id=(
      SELECT s.document_id FROM `service_delivery_details` s
      WHERE s.organization_id=NEW.organization_id AND s.booking_id=NEW.id
      ORDER BY s.document_id DESC LIMIT 1
    );

  INSERT INTO `revenue_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`service_code`,`movement_type`,`amount_delta`,
     `currency`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.patient_id,NEW.service_code,'service_delivery',NEW.payment_amount,
         'UAH','system:execution',NEW.performed_at
  FROM `business_documents` d
  JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND s.booking_id=NEW.id AND d.state='posted'
    AND NEW.patient_category='civilian' AND NEW.payment_amount>0;

  INSERT INTO `patient_settlement_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`movement_type`,`amount_delta`,`currency`,
     `actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.patient_id,'charge',NEW.payment_amount,'UAH',
         'system:execution',NEW.performed_at
  FROM `business_documents` d
  JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND s.booking_id=NEW.id AND d.state='posted'
    AND NEW.patient_category='civilian' AND NEW.payment_amount>0;
END;
--> statement-breakpoint

-- Remove trigger-order dependence from storno. This trigger explicitly reverses the linked operational
-- registrar first, then posts the correction and appends all correction movements. The 0090 reversal
-- projection becomes an idempotent no-op regardless of which AFTER trigger SQLite chooses to run first.
DROP TRIGGER IF EXISTS `service_delivery_reverse_posts_correction`;
--> statement-breakpoint
CREATE TRIGGER `service_delivery_reverse_posts_correction`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.state='posted' AND NEW.state='reversed' AND OLD.document_type='service_delivery'
  AND EXISTS (
    SELECT 1 FROM `service_delivery_details` s
    WHERE s.document_id=NEW.id AND s.organization_id=NEW.organization_id
  )
BEGIN
  UPDATE `business_documents`
  SET state='reversed'
  WHERE organization_id=NEW.organization_id
    AND document_type='study_performance' AND basis_document_id=NEW.id AND state='posted';

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
