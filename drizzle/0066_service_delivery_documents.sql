-- BAS-style service delivery registrar.
-- The medical workflow proves that a study/service was performed; this business document
-- records the economic/operational fact. Payment remains a separate cash fact.

CREATE TABLE IF NOT EXISTS `service_delivery_details` (
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `patient_id` text DEFAULT '' NOT NULL,
  `patient_category` text DEFAULT '' NOT NULL,
  `service_code` text NOT NULL,
  `service_title` text NOT NULL,
  `equipment_id` text NOT NULL,
  `duration_minutes` integer NOT NULL CHECK (`duration_minutes` > 0),
  `anatomical_regions_count` integer DEFAULT 1 NOT NULL CHECK (`anatomical_regions_count` > 0),
  `performed_at` text NOT NULL,
  `radiologist_email` text DEFAULT '' NOT NULL,
  `radiographer_email` text DEFAULT '' NOT NULL,
  `price_amount` integer DEFAULT 0 NOT NULL CHECK (`price_amount` >= 0),
  `charge_amount` integer DEFAULT 0 NOT NULL CHECK (`charge_amount` >= 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`document_id`),
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `service_delivery_booking_idx`
  ON `service_delivery_details` (`organization_id`,`booking_id`,`document_id` DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `services_delivered_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `patient_id` text DEFAULT '' NOT NULL,
  `service_code` text NOT NULL,
  `equipment_id` text NOT NULL,
  `quantity` integer DEFAULT 1 NOT NULL CHECK (`quantity` > 0),
  `anatomical_regions_count` integer DEFAULT 1 NOT NULL CHECK (`anatomical_regions_count` > 0),
  `performed_at` text NOT NULL,
  `actor_email` text NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `services_delivered_document_idx`
  ON `services_delivered_movements` (`organization_id`,`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `services_delivered_service_idx`
  ON `services_delivered_movements` (`organization_id`,`service_code`,`performed_at` DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `revenue_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `patient_id` text DEFAULT '' NOT NULL,
  `service_code` text NOT NULL,
  `movement_type` text NOT NULL CHECK (`movement_type` IN ('service_delivery','service_correction')),
  `amount_delta` integer NOT NULL CHECK (`amount_delta` <> 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `actor_email` text NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `revenue_document_idx`
  ON `revenue_movements` (`organization_id`,`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `revenue_time_idx`
  ON `revenue_movements` (`organization_id`,`occurred_at` DESC,`id` DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `equipment_load_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `equipment_id` text NOT NULL,
  `minutes_delta` integer NOT NULL CHECK (`minutes_delta` <> 0),
  `performed_at` text NOT NULL,
  `actor_email` text NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `equipment_load_document_idx`
  ON `equipment_load_movements` (`organization_id`,`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `equipment_load_equipment_idx`
  ON `equipment_load_movements` (`organization_id`,`equipment_id`,`performed_at` DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `staff_output_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `member_email` text NOT NULL,
  `staff_role` text NOT NULL CHECK (`staff_role` IN ('radiologist','radiographer')),
  `units_delta` integer DEFAULT 1 NOT NULL CHECK (`units_delta` <> 0),
  `anatomical_regions_count` integer DEFAULT 1 NOT NULL CHECK (`anatomical_regions_count` > 0),
  `performed_at` text NOT NULL,
  `actor_email` text NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `staff_output_document_role_idx`
  ON `staff_output_movements` (`organization_id`,`document_id`,`staff_role`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `staff_output_member_idx`
  ON `staff_output_movements` (`organization_id`,`member_email`,`performed_at` DESC);
--> statement-breakpoint

-- Only a completed/performed booking can be turned into a service-delivery document.
-- Draft creation also snapshots the exact business-relevant booking facts.
CREATE TRIGGER IF NOT EXISTS `service_delivery_details_integrity_insert`
BEFORE INSERT ON `service_delivery_details`
BEGIN
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
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `service_delivery_details` s
    JOIN `business_documents` d ON d.id=s.document_id AND d.organization_id=s.organization_id
    WHERE s.organization_id=NEW.organization_id AND s.booking_id=NEW.booking_id
      AND d.state IN ('draft','posted')
  ) THEN RAISE(ABORT,'service_delivery_already_exists') END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `service_delivery_details_no_update_posted`
BEFORE UPDATE ON `service_delivery_details`
WHEN NOT EXISTS (
  SELECT 1 FROM `business_documents` d
  WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft'
)
BEGIN SELECT RAISE(ABORT,'service_delivery_not_draft'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `service_delivery_details_no_delete_posted`
BEFORE DELETE ON `service_delivery_details`
WHEN NOT EXISTS (
  SELECT 1 FROM `business_documents` d
  WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft'
)
BEGIN SELECT RAISE(ABORT,'service_delivery_not_draft'); END;
--> statement-breakpoint

-- Operational/revenue registers are append-only evidence.
CREATE TRIGGER IF NOT EXISTS `services_delivered_no_update` BEFORE UPDATE ON `services_delivered_movements`
BEGIN SELECT RAISE(ABORT,'services_delivered_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `services_delivered_no_delete` BEFORE DELETE ON `services_delivered_movements`
BEGIN SELECT RAISE(ABORT,'services_delivered_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `revenue_no_update` BEFORE UPDATE ON `revenue_movements`
BEGIN SELECT RAISE(ABORT,'revenue_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `revenue_no_delete` BEFORE DELETE ON `revenue_movements`
BEGIN SELECT RAISE(ABORT,'revenue_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `equipment_load_no_update` BEFORE UPDATE ON `equipment_load_movements`
BEGIN SELECT RAISE(ABORT,'equipment_load_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `equipment_load_no_delete` BEFORE DELETE ON `equipment_load_movements`
BEGIN SELECT RAISE(ABORT,'equipment_load_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_output_no_update` BEFORE UPDATE ON `staff_output_movements`
BEGIN SELECT RAISE(ABORT,'staff_output_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_output_no_delete` BEFORE DELETE ON `staff_output_movements`
BEGIN SELECT RAISE(ABORT,'staff_output_movement_immutable'); END;
--> statement-breakpoint

-- Every movement must exactly match its posted registrar snapshot.
CREATE TRIGGER IF NOT EXISTS `services_delivered_integrity_insert`
BEFORE INSERT ON `services_delivered_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='posted'
      AND s.booking_id=NEW.booking_id AND s.patient_id=NEW.patient_id
      AND s.service_code=NEW.service_code AND s.equipment_id=NEW.equipment_id
      AND NEW.quantity=1 AND s.anatomical_regions_count=NEW.anatomical_regions_count
      AND s.performed_at=NEW.performed_at
  ) THEN RAISE(ABORT,'services_delivered_document_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `revenue_integrity_insert`
BEFORE INSERT ON `revenue_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='posted'
      AND s.booking_id=NEW.booking_id AND s.patient_id=NEW.patient_id
      AND s.service_code=NEW.service_code AND s.currency=NEW.currency
      AND NEW.movement_type='service_delivery' AND NEW.amount_delta=s.charge_amount AND s.charge_amount>0
  ) THEN RAISE(ABORT,'revenue_document_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `equipment_load_integrity_insert`
BEFORE INSERT ON `equipment_load_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='posted'
      AND s.booking_id=NEW.booking_id AND s.equipment_id=NEW.equipment_id
      AND NEW.minutes_delta=s.duration_minutes AND s.performed_at=NEW.performed_at
  ) THEN RAISE(ABORT,'equipment_load_document_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_output_integrity_insert`
BEFORE INSERT ON `staff_output_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
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
  ) THEN RAISE(ABORT,'staff_output_document_mismatch') END;
END;
--> statement-breakpoint

-- Extend the shared patient-settlement registrar: service delivery adds the charge;
-- payments/refunds keep the existing finance-document rules.
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
  ) THEN RAISE(ABORT,'patient_settlement_document_mismatch') END;
END;
