-- Split operational storno from the economic service-correction registrar.
-- New study_performance facts are reversed by a dedicated posted study_correction document.
-- Revenue and patient settlements remain owned by the existing service_delivery correction document.
-- Historical service deliveries without a study_performance keep the legacy correction path.

-- A study correction is documentary evidence for exactly one reversed study_performance and its
-- already-posted economic correction. It carries no client-authored snapshot: all lineage, actor and
-- occurrence fields are projected from immutable business documents inside the same D1 transaction.
CREATE TRIGGER IF NOT EXISTS `study_correction_integrity_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.document_type='study_correction'
BEGIN
  SELECT CASE WHEN NEW.state<>'posted'
    THEN RAISE(ABORT,'study_correction_must_be_posted') END;
  SELECT CASE WHEN NEW.basis_document_id IS NULL OR NEW.reversed_document_id IS NULL
    THEN RAISE(ABORT,'study_correction_lineage_required') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `business_documents` existing
    WHERE existing.organization_id=NEW.organization_id
      AND existing.document_type='study_correction'
      AND existing.basis_document_id=NEW.basis_document_id
  ) THEN RAISE(ABORT,'study_correction_source_already_registered') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` p
    JOIN `business_documents` src
      ON src.id=p.basis_document_id AND src.organization_id=p.organization_id
    JOIN `service_correction_details` c
      ON c.organization_id=src.organization_id AND c.source_document_id=src.id
    JOIN `business_documents` ec
      ON ec.id=c.document_id AND ec.organization_id=c.organization_id
    WHERE p.id=NEW.basis_document_id AND p.organization_id=NEW.organization_id
      AND p.document_type='study_performance' AND p.state='reversed'
      AND src.document_type='service_delivery' AND src.state='reversed'
      AND ec.document_type='service_delivery' AND ec.state='posted'
      AND ec.reversed_document_id=src.id
      AND NEW.reversed_document_id=p.id
      AND NEW.number=printf('КВ-%06d',ec.id)
      AND NEW.occurred_at=ec.occurred_at
      AND NEW.created_by=ec.created_by
      AND NEW.posted_by=ec.posted_by
      AND NEW.posted_at=ec.posted_at
  ) THEN RAISE(ABORT,'study_correction_lineage_mismatch') END;
END;
--> statement-breakpoint

-- Performed-study corrections are now owned by study_correction when a performance registrar exists.
-- Legacy sources without study_performance keep the original service correction owner.
DROP TRIGGER IF EXISTS `service_correction_movement_integrity`;
--> statement-breakpoint
CREATE TRIGGER `service_correction_movement_integrity`
BEFORE INSERT ON `service_correction_movements`
BEGIN
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1
      FROM `business_documents` sc
      JOIN `business_documents` p
        ON p.id=sc.basis_document_id AND p.organization_id=sc.organization_id
      JOIN `business_documents` src
        ON src.id=p.basis_document_id AND src.organization_id=p.organization_id
      JOIN `service_correction_details` c
        ON c.organization_id=src.organization_id AND c.source_document_id=src.id
      JOIN `business_documents` ec
        ON ec.id=c.document_id AND ec.organization_id=c.organization_id
      WHERE sc.id=NEW.document_id AND sc.organization_id=NEW.organization_id
        AND sc.document_type='study_correction' AND sc.state='posted'
        AND sc.reversed_document_id=p.id
        AND p.document_type='study_performance' AND p.state='reversed'
        AND src.document_type='service_delivery' AND src.state='reversed'
        AND ec.document_type='service_delivery' AND ec.state='posted'
        AND ec.reversed_document_id=src.id
        AND c.source_document_id=NEW.source_document_id
        AND c.booking_id=NEW.booking_id AND c.patient_id=NEW.patient_id
        AND c.service_code=NEW.service_code AND c.equipment_id=NEW.equipment_id
        AND NEW.quantity_delta=-1
        AND NEW.anatomical_regions_delta=-c.anatomical_regions_count
        AND NEW.reason=c.reason
        AND NEW.actor_email=sc.posted_by AND NEW.occurred_at=sc.occurred_at
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
        AND c.source_document_id=NEW.source_document_id
        AND c.booking_id=NEW.booking_id AND c.patient_id=NEW.patient_id
        AND c.service_code=NEW.service_code AND c.equipment_id=NEW.equipment_id
        AND NEW.quantity_delta=-1
        AND NEW.anatomical_regions_delta=-c.anatomical_regions_count
        AND NEW.reason=c.reason
        AND NOT EXISTS (
          SELECT 1 FROM `business_documents` p
          WHERE p.organization_id=c.organization_id
            AND p.document_type='study_performance' AND p.basis_document_id=c.source_document_id
        )
    )
  ) THEN RAISE(ABORT,'service_correction_movement_mismatch') END;
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
      FROM `business_documents` sc
      JOIN `business_documents` p
        ON p.id=sc.basis_document_id AND p.organization_id=sc.organization_id
      JOIN `business_documents` src
        ON src.id=p.basis_document_id AND src.organization_id=p.organization_id
      JOIN `service_correction_details` c
        ON c.organization_id=src.organization_id AND c.source_document_id=src.id
      JOIN `business_documents` ec
        ON ec.id=c.document_id AND ec.organization_id=c.organization_id
      WHERE sc.id=NEW.document_id AND sc.organization_id=NEW.organization_id
        AND sc.document_type='study_correction' AND sc.state='posted'
        AND sc.reversed_document_id=p.id
        AND p.document_type='study_performance' AND p.state='reversed'
        AND src.document_type='service_delivery' AND src.state='reversed'
        AND ec.document_type='service_delivery' AND ec.state='posted' AND ec.reversed_document_id=src.id
        AND c.booking_id=NEW.booking_id AND c.equipment_id=NEW.equipment_id
        AND NEW.minutes_delta=-c.duration_minutes AND c.performed_at=NEW.performed_at
        AND NEW.actor_email=sc.posted_by AND NEW.occurred_at=sc.occurred_at
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
        AND NOT EXISTS (
          SELECT 1 FROM `business_documents` p
          WHERE p.organization_id=c.organization_id
            AND p.document_type='study_performance' AND p.basis_document_id=c.source_document_id
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
      FROM `business_documents` sc
      JOIN `business_documents` p
        ON p.id=sc.basis_document_id AND p.organization_id=sc.organization_id
      JOIN `business_documents` src
        ON src.id=p.basis_document_id AND src.organization_id=p.organization_id
      JOIN `service_correction_details` c
        ON c.organization_id=src.organization_id AND c.source_document_id=src.id
      JOIN `business_documents` ec
        ON ec.id=c.document_id AND ec.organization_id=c.organization_id
      WHERE sc.id=NEW.document_id AND sc.organization_id=NEW.organization_id
        AND sc.document_type='study_correction' AND sc.state='posted'
        AND sc.reversed_document_id=p.id
        AND p.document_type='study_performance' AND p.state='reversed'
        AND src.document_type='service_delivery' AND src.state='reversed'
        AND ec.document_type='service_delivery' AND ec.state='posted' AND ec.reversed_document_id=src.id
        AND c.booking_id=NEW.booking_id AND c.performed_at=NEW.performed_at
        AND c.anatomical_regions_count=NEW.anatomical_regions_count AND NEW.units_delta=-1
        AND NEW.actor_email=sc.posted_by AND NEW.occurred_at=sc.occurred_at
        AND (
          (NEW.staff_role='radiologist' AND NEW.member_email<>'' AND NEW.member_email=c.radiologist_email)
          OR
          (NEW.staff_role='radiographer' AND NEW.member_email<>'' AND NEW.member_email=c.radiographer_email)
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
        AND NOT EXISTS (
          SELECT 1 FROM `business_documents` p
          WHERE p.organization_id=c.organization_id
            AND p.document_type='study_performance' AND p.basis_document_id=c.source_document_id
        )
    )
  ) THEN RAISE(ABORT,'staff_output_document_mismatch') END;
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS `equipment_correction_requires_reversed_source`;
--> statement-breakpoint
CREATE TRIGGER `equipment_correction_requires_reversed_source`
BEFORE INSERT ON `equipment_load_movements`
WHEN NEW.minutes_delta<0
BEGIN
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1 FROM `business_documents` sc
      JOIN `business_documents` p ON p.id=sc.basis_document_id AND p.organization_id=sc.organization_id
      JOIN `business_documents` src ON src.id=p.basis_document_id AND src.organization_id=p.organization_id
      JOIN `service_correction_details` c ON c.organization_id=src.organization_id AND c.source_document_id=src.id
      WHERE sc.id=NEW.document_id AND sc.organization_id=NEW.organization_id
        AND sc.document_type='study_correction' AND sc.state='posted' AND sc.reversed_document_id=p.id
        AND p.document_type='study_performance' AND p.state='reversed'
        AND src.document_type='service_delivery' AND src.state='reversed'
        AND c.booking_id=NEW.booking_id AND c.equipment_id=NEW.equipment_id
        AND NEW.minutes_delta=-c.duration_minutes AND c.performed_at=NEW.performed_at
    )
    OR
    EXISTS (
      SELECT 1 FROM `service_correction_details` c
      JOIN `business_documents` d ON d.id=c.document_id AND d.organization_id=c.organization_id
      JOIN `business_documents` src ON src.id=c.source_document_id AND src.organization_id=c.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
        AND src.state='reversed' AND d.reversed_document_id=src.id
        AND c.booking_id=NEW.booking_id AND c.equipment_id=NEW.equipment_id
        AND NEW.minutes_delta=-c.duration_minutes AND c.performed_at=NEW.performed_at
        AND NOT EXISTS (
          SELECT 1 FROM `business_documents` p
          WHERE p.organization_id=c.organization_id
            AND p.document_type='study_performance' AND p.basis_document_id=src.id
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
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1 FROM `business_documents` sc
      JOIN `business_documents` p ON p.id=sc.basis_document_id AND p.organization_id=sc.organization_id
      JOIN `business_documents` src ON src.id=p.basis_document_id AND src.organization_id=p.organization_id
      JOIN `service_correction_details` c ON c.organization_id=src.organization_id AND c.source_document_id=src.id
      WHERE sc.id=NEW.document_id AND sc.organization_id=NEW.organization_id
        AND sc.document_type='study_correction' AND sc.state='posted' AND sc.reversed_document_id=p.id
        AND p.document_type='study_performance' AND p.state='reversed'
        AND src.document_type='service_delivery' AND src.state='reversed'
        AND c.booking_id=NEW.booking_id AND NEW.units_delta=-1
        AND c.anatomical_regions_count=NEW.anatomical_regions_count AND c.performed_at=NEW.performed_at
        AND (
          (NEW.staff_role='radiologist' AND NEW.member_email=c.radiologist_email AND NEW.member_email<>'')
          OR
          (NEW.staff_role='radiographer' AND NEW.member_email=c.radiographer_email AND NEW.member_email<>'')
        )
    )
    OR
    EXISTS (
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
        AND NOT EXISTS (
          SELECT 1 FROM `business_documents` p
          WHERE p.organization_id=c.organization_id
            AND p.document_type='study_performance' AND p.basis_document_id=src.id
        )
    )
  ) THEN RAISE(ABORT,'service_correction_source_not_reversed') END;
END;
--> statement-breakpoint

-- Replace the storno posting boundary. The economic correction posts first. If a linked performance
-- exists, it is reversed and one study_correction is created before any negative operational movement.
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

  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,`created_by`,
     `reversed_document_id`,`basis_document_id`,`posted_by`,`posted_at`)
  SELECT p.organization_id,'study_correction',printf('КВ-%06d',ec.id),ec.occurred_at,'posted',
         'Операційне сторно '||p.number,ec.created_by,p.id,p.id,ec.posted_by,ec.posted_at
  FROM `business_documents` p
  JOIN `service_correction_details` c
    ON c.organization_id=p.organization_id AND c.source_document_id=NEW.id
  JOIN `business_documents` ec
    ON ec.id=c.document_id AND ec.organization_id=c.organization_id
  WHERE p.organization_id=NEW.organization_id
    AND p.document_type='study_performance' AND p.basis_document_id=NEW.id AND p.state='reversed'
    AND ec.document_type='service_delivery' AND ec.state='posted' AND ec.reversed_document_id=NEW.id
    AND NOT EXISTS (
      SELECT 1 FROM `business_documents` sc
      WHERE sc.organization_id=p.organization_id AND sc.document_type='study_correction'
        AND sc.basis_document_id=p.id
    );

  INSERT INTO `service_correction_movements`
    (`organization_id`,`document_id`,`source_document_id`,`booking_id`,`patient_id`,`service_code`,`equipment_id`,
     `quantity_delta`,`anatomical_regions_delta`,`reason`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,COALESCE(sc.id,c.document_id),c.source_document_id,c.booking_id,c.patient_id,c.service_code,c.equipment_id,
         -1,-c.anatomical_regions_count,c.reason,COALESCE(sc.posted_by,ec.created_by),COALESCE(sc.occurred_at,ec.occurred_at)
  FROM `service_correction_details` c
  JOIN `business_documents` ec ON ec.id=c.document_id AND ec.organization_id=c.organization_id
  LEFT JOIN `business_documents` p
    ON p.organization_id=c.organization_id AND p.document_type='study_performance'
    AND p.basis_document_id=c.source_document_id AND p.state='reversed'
  LEFT JOIN `business_documents` sc
    ON sc.organization_id=c.organization_id AND sc.document_type='study_correction'
    AND sc.basis_document_id=p.id AND sc.state='posted'
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id AND ec.state='posted';

  INSERT INTO `equipment_load_movements`
    (`organization_id`,`document_id`,`booking_id`,`equipment_id`,`minutes_delta`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,COALESCE(sc.id,c.document_id),c.booking_id,c.equipment_id,-c.duration_minutes,c.performed_at,
         COALESCE(sc.posted_by,ec.created_by),COALESCE(sc.occurred_at,ec.occurred_at)
  FROM `service_correction_details` c
  JOIN `business_documents` ec ON ec.id=c.document_id AND ec.organization_id=c.organization_id
  LEFT JOIN `business_documents` p
    ON p.organization_id=c.organization_id AND p.document_type='study_performance'
    AND p.basis_document_id=c.source_document_id AND p.state='reversed'
  LEFT JOIN `business_documents` sc
    ON sc.organization_id=c.organization_id AND sc.document_type='study_correction'
    AND sc.basis_document_id=p.id AND sc.state='posted'
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id AND ec.state='posted';

  INSERT INTO `revenue_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`service_code`,`movement_type`,`amount_delta`,`currency`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,c.document_id,c.booking_id,c.patient_id,c.service_code,'service_correction',-c.charge_amount,
         c.currency,ec.created_by,ec.occurred_at
  FROM `service_correction_details` c
  JOIN `business_documents` ec ON ec.id=c.document_id AND ec.organization_id=c.organization_id
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id
    AND ec.state='posted' AND c.charge_amount>0;

  INSERT INTO `patient_settlement_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`movement_type`,`amount_delta`,`currency`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,c.document_id,c.booking_id,c.patient_id,'adjustment',-c.charge_amount,
         c.currency,ec.created_by,ec.occurred_at
  FROM `service_correction_details` c
  JOIN `business_documents` ec ON ec.id=c.document_id AND ec.organization_id=c.organization_id
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id
    AND ec.state='posted' AND c.charge_amount>0;

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`member_email`,`staff_role`,`units_delta`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,COALESCE(sc.id,c.document_id),c.booking_id,c.radiologist_email,'radiologist',-1,
         c.anatomical_regions_count,c.performed_at,COALESCE(sc.posted_by,ec.created_by),COALESCE(sc.occurred_at,ec.occurred_at)
  FROM `service_correction_details` c
  JOIN `business_documents` ec ON ec.id=c.document_id AND ec.organization_id=c.organization_id
  LEFT JOIN `business_documents` p
    ON p.organization_id=c.organization_id AND p.document_type='study_performance'
    AND p.basis_document_id=c.source_document_id AND p.state='reversed'
  LEFT JOIN `business_documents` sc
    ON sc.organization_id=c.organization_id AND sc.document_type='study_correction'
    AND sc.basis_document_id=p.id AND sc.state='posted'
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id
    AND ec.state='posted' AND c.radiologist_email<>'';

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`member_email`,`staff_role`,`units_delta`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT c.organization_id,COALESCE(sc.id,c.document_id),c.booking_id,c.radiographer_email,'radiographer',-1,
         c.anatomical_regions_count,c.performed_at,COALESCE(sc.posted_by,ec.created_by),COALESCE(sc.occurred_at,ec.occurred_at)
  FROM `service_correction_details` c
  JOIN `business_documents` ec ON ec.id=c.document_id AND ec.organization_id=c.organization_id
  LEFT JOIN `business_documents` p
    ON p.organization_id=c.organization_id AND p.document_type='study_performance'
    AND p.basis_document_id=c.source_document_id AND p.state='reversed'
  LEFT JOIN `business_documents` sc
    ON sc.organization_id=c.organization_id AND sc.document_type='study_correction'
    AND sc.basis_document_id=p.id AND sc.state='posted'
  WHERE c.organization_id=NEW.organization_id AND c.source_document_id=NEW.id
    AND ec.state='posted' AND c.radiographer_email<>'';
END;
