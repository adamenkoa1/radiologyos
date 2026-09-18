-- BAS-style storno for a posted service delivery.
-- A correction is a separate business_documents row in the service_delivery family, linked through
-- reversed_document_id and service_correction_details. The original document is preserved and marked reversed.

CREATE TABLE IF NOT EXISTS `service_correction_details` (
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `source_document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `correction_kind` text DEFAULT 'storno' NOT NULL CHECK (`correction_kind`='storno'),
  `reason` text NOT NULL CHECK (length(trim(`reason`)) >= 5),
  `patient_id` text DEFAULT '' NOT NULL,
  `patient_category` text DEFAULT '' NOT NULL,
  `service_code` text NOT NULL,
  `service_title` text NOT NULL,
  `equipment_id` text NOT NULL,
  `duration_minutes` integer NOT NULL CHECK (`duration_minutes` > 0),
  `anatomical_regions_count` integer NOT NULL CHECK (`anatomical_regions_count` > 0),
  `performed_at` text NOT NULL,
  `radiologist_email` text DEFAULT '' NOT NULL,
  `radiographer_email` text DEFAULT '' NOT NULL,
  `charge_amount` integer DEFAULT 0 NOT NULL CHECK (`charge_amount` >= 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`document_id`),
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`),
  FOREIGN KEY (`source_document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `service_correction_source_unique`
  ON `service_correction_details` (`organization_id`,`source_document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `service_correction_booking_idx`
  ON `service_correction_details` (`organization_id`,`booking_id`,`document_id` DESC);
--> statement-breakpoint

-- Separate service-count correction register because the original services_delivered register is append-only
-- and intentionally stores only positive performed facts.
CREATE TABLE IF NOT EXISTS `service_correction_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `source_document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `patient_id` text DEFAULT '' NOT NULL,
  `service_code` text NOT NULL,
  `equipment_id` text NOT NULL,
  `quantity_delta` integer NOT NULL CHECK (`quantity_delta`=-1),
  `anatomical_regions_delta` integer NOT NULL CHECK (`anatomical_regions_delta` < 0),
  `reason` text NOT NULL,
  `actor_email` text NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`),
  FOREIGN KEY (`source_document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `service_correction_movement_document_idx`
  ON `service_correction_movements` (`organization_id`,`document_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `service_correction_movement_source_idx`
  ON `service_correction_movements` (`organization_id`,`source_document_id`);
--> statement-breakpoint

-- Correction details must copy the exact posted source registrar. The correction business document is
-- a distinct row in the same service_delivery family and must link to that source via reversed_document_id.
CREATE TRIGGER IF NOT EXISTS `service_correction_details_integrity_insert`
BEFORE INSERT ON `service_correction_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `business_documents` src
      ON src.id=NEW.source_document_id AND src.organization_id=d.organization_id
    JOIN `service_delivery_details` s
      ON s.document_id=src.id AND s.organization_id=src.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='draft'
      AND d.reversed_document_id=NEW.source_document_id
      AND src.document_type='service_delivery' AND src.state='posted'
      AND s.booking_id=NEW.booking_id
      AND s.patient_id=NEW.patient_id
      AND s.patient_category=NEW.patient_category
      AND s.service_code=NEW.service_code
      AND s.service_title=NEW.service_title
      AND s.equipment_id=NEW.equipment_id
      AND s.duration_minutes=NEW.duration_minutes
      AND s.anatomical_regions_count=NEW.anatomical_regions_count
      AND s.performed_at=NEW.performed_at
      AND s.radiologist_email=NEW.radiologist_email
      AND s.radiographer_email=NEW.radiographer_email
      AND s.charge_amount=NEW.charge_amount
      AND s.currency=NEW.currency
      AND NEW.correction_kind='storno'
      AND length(trim(NEW.reason))>=5
  ) THEN RAISE(ABORT,'service_correction_source_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `service_correction_details_no_update`
BEFORE UPDATE ON `service_correction_details`
BEGIN SELECT RAISE(ABORT,'service_correction_detail_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `service_correction_details_no_delete_posted`
BEFORE DELETE ON `service_correction_details`
WHEN NOT EXISTS (
  SELECT 1 FROM `business_documents` d
  WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft'
)
BEGIN SELECT RAISE(ABORT,'service_correction_detail_immutable'); END;
--> statement-breakpoint

-- A correction document must never also acquire a normal service_delivery_details row.
CREATE TRIGGER IF NOT EXISTS `service_delivery_details_not_correction`
BEFORE INSERT ON `service_delivery_details`
WHEN EXISTS (
  SELECT 1 FROM `business_documents` d
  WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
    AND d.document_type='service_delivery' AND d.reversed_document_id IS NOT NULL
)
BEGIN SELECT RAISE(ABORT,'service_delivery_correction_cannot_be_delivery'); END;
--> statement-breakpoint

-- Once a booking has a reversed service-delivery registrar, that same performed fact may not be posted again.
CREATE TRIGGER IF NOT EXISTS `service_delivery_no_repost_after_reversal`
BEFORE INSERT ON `service_delivery_details`
WHEN EXISTS (
  SELECT 1 FROM `service_delivery_details` s
  JOIN `business_documents` d ON d.id=s.document_id AND d.organization_id=s.organization_id
  WHERE s.organization_id=NEW.organization_id AND s.booking_id=NEW.booking_id
    AND d.document_type='service_delivery' AND d.state='reversed'
)
BEGIN SELECT RAISE(ABORT,'service_delivery_reversed'); END;
--> statement-breakpoint

-- Reversed source facts remain immutable; storno is not permission to rewrite history.
CREATE TRIGGER IF NOT EXISTS `booking_reversed_service_snapshot_immutable`
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
BEGIN SELECT RAISE(ABORT,'service_delivery_booking_immutable'); END;
--> statement-breakpoint

-- Even a no-op execution update must not re-trigger automatic posting after storno.
CREATE TRIGGER IF NOT EXISTS `booking_reversed_service_no_repost`
BEFORE UPDATE OF `performed_at`,`status` ON `bookings`
WHEN NEW.status='completed' AND NEW.performed_at<>''
  AND EXISTS (
    SELECT 1 FROM `service_delivery_details` s
    JOIN `business_documents` d ON d.id=s.document_id AND d.organization_id=s.organization_id
    WHERE s.organization_id=OLD.organization_id AND s.booking_id=OLD.id
      AND d.document_type='service_delivery' AND d.state='reversed'
  )
BEGIN SELECT RAISE(ABORT,'service_delivery_reversed'); END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `service_correction_movements_no_update`
BEFORE UPDATE ON `service_correction_movements`
BEGIN SELECT RAISE(ABORT,'service_correction_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `service_correction_movements_no_delete`
BEFORE DELETE ON `service_correction_movements`
BEGIN SELECT RAISE(ABORT,'service_correction_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `service_correction_movement_integrity`
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
      AND src.state='reversed'
      AND c.source_document_id=NEW.source_document_id
      AND c.booking_id=NEW.booking_id
      AND c.patient_id=NEW.patient_id
      AND c.service_code=NEW.service_code
      AND c.equipment_id=NEW.equipment_id
      AND NEW.quantity_delta=-1
      AND NEW.anatomical_regions_delta=-c.anatomical_regions_count
      AND NEW.reason=c.reason
  ) THEN RAISE(ABORT,'service_correction_movement_mismatch') END;
END;
--> statement-breakpoint

-- Extend existing operational/economic register guards with the negative storno path.
DROP TRIGGER IF EXISTS `revenue_integrity_insert`;
--> statement-breakpoint
CREATE TRIGGER `revenue_integrity_insert`
BEFORE INSERT ON `revenue_movements`
BEGIN
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1 FROM `business_documents` d
      JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='service_delivery' AND d.state='posted'
        AND s.booking_id=NEW.booking_id AND s.patient_id=NEW.patient_id
        AND s.service_code=NEW.service_code AND s.currency=NEW.currency
        AND NEW.movement_type='service_delivery' AND NEW.amount_delta=s.charge_amount AND s.charge_amount>0
    )
    OR
    EXISTS (
      SELECT 1 FROM `business_documents` d
      JOIN `service_correction_details` c ON c.document_id=d.id AND c.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='service_delivery' AND d.state='posted'
        AND d.reversed_document_id=c.source_document_id
        AND c.booking_id=NEW.booking_id AND c.patient_id=NEW.patient_id
        AND c.service_code=NEW.service_code AND c.currency=NEW.currency
        AND NEW.movement_type='service_correction' AND NEW.amount_delta=-c.charge_amount AND c.charge_amount>0
    )
  ) THEN RAISE(ABORT,'revenue_document_mismatch') END;
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS `equipment_load_integrity_insert`;
--> statement-breakpoint
CREATE TRIGGER `equipment_load_integrity_insert`
BEFORE INSERT ON `equipment_load_movements`
BEGIN
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1 FROM `business_documents` d
      JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='service_delivery' AND d.state='posted'
        AND s.booking_id=NEW.booking_id AND s.equipment_id=NEW.equipment_id
        AND NEW.minutes_delta=s.duration_minutes AND s.performed_at=NEW.performed_at
    )
    OR
    EXISTS (
      SELECT 1 FROM `business_documents` d
      JOIN `service_correction_details` c ON c.document_id=d.id AND c.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='service_delivery' AND d.state='posted'
        AND d.reversed_document_id=c.source_document_id
        AND c.booking_id=NEW.booking_id AND c.equipment_id=NEW.equipment_id
        AND NEW.minutes_delta=-c.duration_minutes AND c.performed_at=NEW.performed_at
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
      SELECT 1 FROM `business_documents` d
      JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='service_delivery' AND d.state='posted'
        AND s.booking_id=NEW.booking_id AND s.performed_at=NEW.performed_at
        AND s.anatomical_regions_count=NEW.anatomical_regions_count AND NEW.units_delta=1
        AND (
          (NEW.staff_role='radiologist' AND NEW.member_email<>'' AND NEW.member_email=s.radiologist_email)
          OR
          (NEW.staff_role='radiographer' AND NEW.member_email<>'' AND NEW.member_email=s.radiographer_email)
        )
    )
    OR
    EXISTS (
      SELECT 1 FROM `business_documents` d
      JOIN `service_correction_details` c ON c.document_id=d.id AND c.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='service_delivery' AND d.state='posted'
        AND d.reversed_document_id=c.source_document_id
        AND c.booking_id=NEW.booking_id AND c.performed_at=NEW.performed_at
        AND c.anatomical_regions_count=NEW.anatomical_regions_count AND NEW.units_delta=-1
        AND (
          (NEW.staff_role='radiologist' AND NEW.member_email<>'' AND NEW.member_email=c.radiologist_email)
          OR
          (NEW.staff_role='radiographer' AND NEW.member_email<>'' AND NEW.member_email=c.radiographer_email)
        )
    )
  ) THEN RAISE(ABORT,'staff_output_document_mismatch') END;
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS `patient_settlement_finance_integrity`;
--> statement-breakpoint
CREATE TRIGGER `patient_settlement_finance_integrity`
BEFORE INSERT ON `patient_settlement_movements`
BEGIN
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1
      FROM `business_documents` d
      JOIN `finance_document_details` f ON f.document_id=d.id AND f.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
        AND f.booking_id=NEW.booking_id AND f.patient_id=NEW.patient_id AND f.currency=NEW.currency
        AND (
          (d.document_type='payment' AND NEW.movement_type='payment' AND NEW.amount_delta=-f.amount)
          OR
          (d.document_type='refund' AND NEW.movement_type='refund' AND NEW.amount_delta=f.amount)
        )
    )
    OR
    EXISTS (
      SELECT 1
      FROM `business_documents` d
      JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='service_delivery' AND d.state='posted'
        AND s.booking_id=NEW.booking_id AND s.patient_id=NEW.patient_id AND s.currency=NEW.currency
        AND NEW.movement_type='charge' AND NEW.amount_delta=s.charge_amount AND s.charge_amount>0
    )
    OR
    EXISTS (
      SELECT 1
      FROM `business_documents` d
      JOIN `service_correction_details` c ON c.document_id=d.id AND c.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='service_delivery' AND d.state='posted'
        AND d.reversed_document_id=c.source_document_id
        AND c.booking_id=NEW.booking_id AND c.patient_id=NEW.patient_id AND c.currency=NEW.currency
        AND NEW.movement_type='adjustment' AND NEW.amount_delta=-c.charge_amount AND c.charge_amount>0
    )
  ) THEN RAISE(ABORT,'patient_settlement_document_mismatch') END;
END;
