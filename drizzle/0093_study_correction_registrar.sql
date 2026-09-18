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

-- 0093 business_documents document-type expansion
-- SQLite cannot alter a CHECK constraint in place. D1 file imports are atomic; defer parent-FK
-- validation until the shadow table has replaced the original and every attached guard/index is restored.
PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
PRAGMA legacy_alter_table = ON;
--> statement-breakpoint
CREATE TABLE `__new_business_documents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_type` text NOT NULL CHECK (`document_type` IN (
    'patient_order','appointment','service_delivery','payment','refund',
    'inventory_receipt','inventory_writeoff','inventory_transfer','inventory_count',
    'study_performance','result_delivery','study_correction'
  )),
  `number` text DEFAULT '' NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `state` text DEFAULT 'draft' NOT NULL CHECK (`state` IN ('draft','posted','reversed','cancelled')),
  `comment` text DEFAULT '' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `posted_by` text DEFAULT '' NOT NULL,
  `posted_at` text DEFAULT '' NOT NULL,
  `reversed_document_id` integer, `basis_document_id` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`),
  FOREIGN KEY (`reversed_document_id`) REFERENCES `business_documents`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_business_documents` (`id`,`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,`created_by`,`created_at`,`posted_by`,`posted_at`,`reversed_document_id`,`basis_document_id`)
SELECT `id`,`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,`created_by`,`created_at`,`posted_by`,`posted_at`,`reversed_document_id`,`basis_document_id` FROM `business_documents`;
--> statement-breakpoint
DROP TABLE `business_documents`;
--> statement-breakpoint
ALTER TABLE `__new_business_documents` RENAME TO `business_documents`;
--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;
--> statement-breakpoint
CREATE INDEX `business_documents_basis_idx`
  ON `business_documents` (`organization_id`,`basis_document_id`,`id`)
  WHERE `basis_document_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `business_documents_id_org_idx`
  ON `business_documents` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_documents_org_id_idx`
  ON `business_documents` (`organization_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_documents_org_type_number_idx`
  ON `business_documents` (`organization_id`,`document_type`,`number`) WHERE `number` <> '';
--> statement-breakpoint
CREATE INDEX `business_documents_org_type_state_idx`
  ON `business_documents` (`organization_id`,`document_type`,`state`,`occurred_at` DESC,`id` DESC);
--> statement-breakpoint
CREATE TRIGGER `business_document_basis_integrity_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.basis_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.id IS NOT NULL AND NEW.id=NEW.basis_document_id
    THEN RAISE(ABORT,'business_document_basis_self_reference') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'business_document_basis_tenant_mismatch') END;

  SELECT CASE WHEN NEW.document_type='payment' AND NOT EXISTS (
    SELECT 1 FROM business_documents src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type='patient_order'
  ) THEN RAISE(ABORT,'payment_basis_must_be_patient_order') END;

  SELECT CASE WHEN NEW.document_type='refund' AND NOT EXISTS (
    SELECT 1 FROM business_documents src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type='payment'
  ) THEN RAISE(ABORT,'refund_basis_must_be_payment') END;

  SELECT CASE WHEN NEW.document_type='service_delivery' AND NOT EXISTS (
    SELECT 1 FROM business_documents src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type IN ('patient_order','service_delivery')
  ) THEN RAISE(ABORT,'service_delivery_basis_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `business_document_basis_integrity_update`
BEFORE UPDATE OF `basis_document_id`,`document_type`,`organization_id` ON `business_documents`
WHEN NEW.basis_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.id=NEW.basis_document_id
    THEN RAISE(ABORT,'business_document_basis_self_reference') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'business_document_basis_tenant_mismatch') END;

  SELECT CASE WHEN NEW.document_type='payment' AND NOT EXISTS (
    SELECT 1 FROM business_documents src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type='patient_order'
  ) THEN RAISE(ABORT,'payment_basis_must_be_patient_order') END;

  SELECT CASE WHEN NEW.document_type='refund' AND NOT EXISTS (
    SELECT 1 FROM business_documents src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type='payment'
  ) THEN RAISE(ABORT,'refund_basis_must_be_payment') END;

  SELECT CASE WHEN NEW.document_type='service_delivery' AND NOT EXISTS (
    SELECT 1 FROM business_documents src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type IN ('patient_order','service_delivery')
  ) THEN RAISE(ABORT,'service_delivery_basis_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `business_document_cancelled_basis_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.basis_document_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type='patient_order' AND src.state='cancelled'
  )
BEGIN SELECT RAISE(ABORT,'business_document_basis_cancelled'); END;
--> statement-breakpoint
CREATE TRIGGER `business_document_cancelled_basis_update`
BEFORE UPDATE OF `basis_document_id`,`organization_id` ON `business_documents`
WHEN NEW.basis_document_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type='patient_order' AND src.state='cancelled'
  )
BEGIN SELECT RAISE(ABORT,'business_document_basis_cancelled'); END;
--> statement-breakpoint
CREATE TRIGGER `business_document_reversal_tenant_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.reversed_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d WHERE d.id=NEW.reversed_document_id AND d.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'business_document_reversal_tenant_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER `business_document_reversal_tenant_update`
BEFORE UPDATE OF `reversed_document_id`,`organization_id` ON `business_documents`
WHEN NEW.reversed_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d WHERE d.id=NEW.reversed_document_id AND d.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'business_document_reversal_tenant_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER `business_documents_identity_immutable`
BEFORE UPDATE ON `business_documents`
WHEN NEW.organization_id <> OLD.organization_id
  OR NEW.document_type <> OLD.document_type
  OR NEW.created_by <> OLD.created_by
  OR NEW.created_at <> OLD.created_at
  OR (OLD.number <> '' AND NEW.number <> OLD.number)
BEGIN
  SELECT RAISE(ABORT,'business_document_identity_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `business_documents_immutable_after_draft`
BEFORE UPDATE ON `business_documents`
WHEN OLD.state <> 'draft'
BEGIN
  SELECT CASE WHEN NOT (
    OLD.state='posted' AND NEW.state='reversed'
    AND NEW.organization_id=OLD.organization_id
    AND NEW.document_type=OLD.document_type
    AND NEW.number=OLD.number
    AND NEW.occurred_at=OLD.occurred_at
    AND NEW.comment=OLD.comment
    AND NEW.created_by=OLD.created_by
    AND NEW.created_at=OLD.created_at
    AND NEW.posted_by=OLD.posted_by
    AND NEW.posted_at=OLD.posted_at
    AND NEW.reversed_document_id IS OLD.reversed_document_id
    AND NEW.basis_document_id IS OLD.basis_document_id
  ) THEN RAISE(ABORT,'business_document_immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER `business_documents_no_delete_posted`
BEFORE DELETE ON `business_documents`
WHEN OLD.state <> 'draft'
BEGIN
  SELECT RAISE(ABORT,'business_document_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_receipt_supplier_payable_post`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.state='draft' AND NEW.state='posted' AND NEW.document_type='inventory_receipt'
BEGIN
  INSERT INTO supplier_payable_movements (
    organization_id,supplier_counterparty_id,supplier_name,receipt_document_id,payment_document_id,
    movement_type,amount_delta,currency,actor_email,occurred_at
  )
  SELECT NEW.organization_id,l.supplier_counterparty_id,l.supplier,NEW.id,NULL,
         'receipt_accrual',SUM(l.line_amount),'UAH',NEW.posted_by,NEW.posted_at
  FROM inventory_document_lines l
  WHERE l.organization_id=NEW.organization_id AND l.document_id=NEW.id
    AND l.supplier_counterparty_id IS NOT NULL AND l.line_amount > 0
  GROUP BY l.supplier_counterparty_id,l.supplier;
END;
--> statement-breakpoint
CREATE TRIGGER `patient_order_cancel_requires_booking_cancelled`
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
CREATE TRIGGER `payment_posts_patient_order`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.state='draft' AND NEW.state='posted' AND NEW.document_type='payment' AND NEW.basis_document_id IS NOT NULL
BEGIN
  UPDATE business_documents
  SET state='posted',posted_by=NEW.posted_by,posted_at=NEW.posted_at
  WHERE id=NEW.basis_document_id AND organization_id=NEW.organization_id
    AND document_type='patient_order' AND state='draft';
END;
--> statement-breakpoint
CREATE TRIGGER `result_delivery_details_from_document`
AFTER INSERT ON `business_documents`
WHEN NEW.document_type='result_delivery'
BEGIN
  INSERT INTO `result_delivery_details`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`service_title`,
     `protocol_number`,`protocol_version`,`signed_by`,`signed_at`,
     `delivered_by`,`delivered_at`)
  SELECT
    NEW.organization_id,NEW.id,p.booking_id,b.patient_id,b.service,
    p.number,p.version,p.signed_by,p.signed_at,
    NEW.posted_by,NEW.posted_at
  FROM `protocols` p
  JOIN `bookings` b
    ON b.id=p.booking_id AND b.organization_id=p.organization_id
  WHERE p.organization_id=NEW.organization_id
    AND p.status='issued'
    AND NEW.number=printf('ВР-%06d',p.booking_id);
END;
--> statement-breakpoint
CREATE TRIGGER `result_delivery_document_integrity_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.document_type='result_delivery'
BEGIN
  SELECT CASE WHEN NEW.state<>'posted'
    THEN RAISE(ABORT,'result_delivery_must_be_posted') END;
  SELECT CASE WHEN NEW.created_by='' OR NEW.posted_by='' OR NEW.created_by<>NEW.posted_by
    THEN RAISE(ABORT,'result_delivery_actor_invalid') END;
  SELECT CASE WHEN NEW.occurred_at='' OR NEW.posted_at='' OR NEW.occurred_at<>NEW.posted_at
    THEN RAISE(ABORT,'result_delivery_timestamp_invalid') END;
  SELECT CASE WHEN NEW.reversed_document_id IS NOT NULL
    THEN RAISE(ABORT,'result_delivery_reversal_invalid') END;
  SELECT CASE WHEN NEW.comment<>'Видача результату пацієнту'
    THEN RAISE(ABORT,'result_delivery_comment_invalid') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `protocols` p
    JOIN `bookings` b
      ON b.id=p.booking_id AND b.organization_id=p.organization_id
    WHERE p.organization_id=NEW.organization_id
      AND p.status='issued'
      AND p.signed_by<>'' AND p.signed_at<>'' AND p.signed_version=p.version
      AND NEW.number=printf('ВР-%06d',p.booking_id)
      AND (
        (
          NEW.basis_document_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM `business_documents` perf
            JOIN `business_documents` src
              ON src.id=perf.basis_document_id AND src.organization_id=perf.organization_id
            JOIN `service_delivery_details` s
              ON s.document_id=src.id AND s.organization_id=src.organization_id
            WHERE perf.organization_id=NEW.organization_id
              AND perf.document_type='study_performance' AND perf.state='posted'
              AND src.document_type='service_delivery'
              AND s.booking_id=p.booking_id
          )
        )
        OR NEW.basis_document_id=(
          SELECT perf.id
          FROM `business_documents` perf
          JOIN `business_documents` src
            ON src.id=perf.basis_document_id AND src.organization_id=perf.organization_id
          JOIN `service_delivery_details` s
            ON s.document_id=src.id AND s.organization_id=src.organization_id
          WHERE perf.organization_id=NEW.organization_id
            AND perf.document_type='study_performance' AND perf.state='posted'
            AND src.document_type='service_delivery'
            AND s.booking_id=p.booking_id
          ORDER BY perf.id DESC
          LIMIT 1
        )
      )
  ) THEN RAISE(ABORT,'result_delivery_protocol_or_basis_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER `result_delivery_document_no_state_change`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='result_delivery' AND NEW.state<>OLD.state
BEGIN
  SELECT RAISE(ABORT,'result_delivery_document_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `service_correction_document_draft_frozen`
BEFORE UPDATE ON `business_documents`
WHEN OLD.state='draft'
  AND EXISTS (
    SELECT 1 FROM `service_correction_details` c
    WHERE c.document_id=OLD.id AND c.organization_id=OLD.organization_id
  )
BEGIN
  SELECT CASE WHEN NOT (
    NEW.state='posted'
    AND NEW.organization_id=OLD.organization_id
    AND NEW.document_type=OLD.document_type
    AND NEW.number=OLD.number
    AND NEW.occurred_at=OLD.occurred_at
    AND NEW.comment=OLD.comment
    AND NEW.created_by=OLD.created_by
    AND NEW.created_at=OLD.created_at
    AND NEW.reversed_document_id IS OLD.reversed_document_id
    AND NEW.posted_by=OLD.created_by
    AND NEW.posted_at<>''
  ) THEN RAISE(ABORT,'service_correction_document_frozen') END;
END;
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
--> statement-breakpoint
CREATE TRIGGER `service_delivery_reverse_requires_correction`
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
CREATE TRIGGER `study_correction_integrity_insert`
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
CREATE TRIGGER `study_performance_from_service_delivery_post`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='service_delivery'
  AND OLD.state='draft'
  AND NEW.state='posted'
BEGIN
  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,
     `created_by`,`posted_by`,`posted_at`,`basis_document_id`)
  SELECT
    NEW.organization_id,
    'study_performance',
    printf('ВД-%06d',NEW.id),
    s.performed_at,
    'posted',
    'Факт виконання дослідження',
    NEW.posted_by,
    NEW.posted_by,
    NEW.posted_at,
    NEW.id
  FROM `service_delivery_details` s
  WHERE s.organization_id=NEW.organization_id
    AND s.document_id=NEW.id
    AND NOT EXISTS (
      SELECT 1 FROM `business_documents` p
      WHERE p.organization_id=NEW.organization_id
        AND p.document_type='study_performance'
        AND p.basis_document_id=NEW.id
    );
END;
--> statement-breakpoint
CREATE TRIGGER `study_performance_from_service_delivery_reversal`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='service_delivery'
  AND OLD.state='posted'
  AND NEW.state='reversed'
BEGIN
  UPDATE `business_documents`
  SET state='reversed'
  WHERE organization_id=NEW.organization_id
    AND document_type='study_performance'
    AND basis_document_id=NEW.id
    AND state='posted';
END;
--> statement-breakpoint
CREATE TRIGGER `study_performance_integrity_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.document_type='study_performance'
BEGIN
  SELECT CASE WHEN NEW.basis_document_id IS NULL
    THEN RAISE(ABORT,'study_performance_basis_required') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id
      AND src.organization_id=NEW.organization_id
      AND src.document_type='service_delivery'
      AND src.state='posted'
  ) THEN RAISE(ABORT,'study_performance_basis_invalid') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `service_delivery_details` s
    WHERE s.document_id=NEW.basis_document_id
      AND s.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'study_performance_snapshot_missing') END;

  SELECT CASE WHEN NEW.number<>printf('ВД-%06d',NEW.basis_document_id)
    THEN RAISE(ABORT,'study_performance_number_invalid') END;

  SELECT CASE WHEN NEW.state<>'posted'
    THEN RAISE(ABORT,'study_performance_state_invalid') END;

  SELECT CASE WHEN NEW.occurred_at<>(
    SELECT s.performed_at FROM `service_delivery_details` s
    WHERE s.document_id=NEW.basis_document_id
      AND s.organization_id=NEW.organization_id
    LIMIT 1
  ) THEN RAISE(ABORT,'study_performance_occurred_at_mismatch') END;

  SELECT CASE WHEN NEW.created_by<>(
    SELECT src.posted_by FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
    LIMIT 1
  ) OR NEW.posted_by<>(
    SELECT src.posted_by FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
    LIMIT 1
  ) THEN RAISE(ABORT,'study_performance_actor_mismatch') END;

  SELECT CASE WHEN NEW.posted_at<>(
    SELECT src.posted_at FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
    LIMIT 1
  ) THEN RAISE(ABORT,'study_performance_posted_at_mismatch') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `business_documents` p
    WHERE p.organization_id=NEW.organization_id
      AND p.document_type='study_performance'
      AND p.basis_document_id=NEW.basis_document_id
  ) THEN RAISE(ABORT,'study_performance_source_already_registered') END;
END;
--> statement-breakpoint
CREATE TRIGGER `study_performance_operational_post`
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
CREATE TRIGGER `study_performance_reversal_requires_source_reversed`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='study_performance'
  AND OLD.state='posted'
  AND NEW.state='reversed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=OLD.basis_document_id
      AND src.organization_id=OLD.organization_id
      AND src.document_type='service_delivery'
      AND src.state='reversed'
  ) THEN RAISE(ABORT,'study_performance_source_storno_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER `typed_document_basis_draft_frozen`
BEFORE UPDATE OF `basis_document_id` ON `business_documents`
WHEN OLD.state='draft' AND OLD.basis_document_id IS NOT NEW.basis_document_id
  AND (
    EXISTS (SELECT 1 FROM patient_order_details o WHERE o.document_id=OLD.id AND o.organization_id=OLD.organization_id)
    OR EXISTS (SELECT 1 FROM finance_document_details f WHERE f.document_id=OLD.id AND f.organization_id=OLD.organization_id)
    OR EXISTS (SELECT 1 FROM service_delivery_details s WHERE s.document_id=OLD.id AND s.organization_id=OLD.organization_id)
    OR EXISTS (SELECT 1 FROM service_correction_details c WHERE c.document_id=OLD.id AND c.organization_id=OLD.organization_id)
  )
BEGIN SELECT RAISE(ABORT,'business_document_basis_frozen'); END;
--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;
--> statement-breakpoint
