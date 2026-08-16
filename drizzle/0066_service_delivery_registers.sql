-- BAS-style service delivery registrar.
-- A service act is created only from the canonical execution_recorded event after performed_at exists.
-- Historical performed bookings are not backfilled heuristically.

CREATE TABLE IF NOT EXISTS `service_delivery_details` (
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `patient_id` text DEFAULT '' NOT NULL,
  `service_code` text NOT NULL,
  `service_name` text NOT NULL,
  `patient_category` text NOT NULL,
  `charge_amount` integer DEFAULT 0 NOT NULL CHECK (`charge_amount` >= 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `equipment_id` text NOT NULL,
  `duration_minutes` integer NOT NULL CHECK (`duration_minutes` > 0),
  `performed_at` text NOT NULL,
  `anatomical_regions_count` integer DEFAULT 1 NOT NULL CHECK (`anatomical_regions_count` BETWEEN 1 AND 20),
  `radiologist_email` text DEFAULT '' NOT NULL,
  `radiographer_email` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`document_id`),
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `service_delivery_booking_idx`
  ON `service_delivery_details` (`organization_id`,`booking_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `service_delivery_time_idx`
  ON `service_delivery_details` (`organization_id`,`performed_at` DESC,`document_id` DESC);
--> statement-breakpoint

-- Positive revenue is recognized only when a chargeable civilian service is actually performed.
CREATE TABLE IF NOT EXISTS `revenue_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `movement_type` text NOT NULL CHECK (`movement_type` IN ('service_charge','service_reversal')),
  `amount_delta` integer NOT NULL CHECK (`amount_delta` <> 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `service_code` text NOT NULL,
  `actor_email` text NOT NULL,
  `occurred_at` text NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `revenue_document_idx`
  ON `revenue_movements` (`organization_id`,`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `revenue_time_idx`
  ON `revenue_movements` (`organization_id`,`occurred_at` DESC,`id` DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `equipment_workload_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `equipment_id` text NOT NULL,
  `study_count` integer DEFAULT 1 NOT NULL CHECK (`study_count` = 1),
  `duration_minutes` integer NOT NULL CHECK (`duration_minutes` > 0),
  `anatomical_regions_count` integer NOT NULL CHECK (`anatomical_regions_count` BETWEEN 1 AND 20),
  `performed_at` text NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `equipment_workload_document_idx`
  ON `equipment_workload_movements` (`organization_id`,`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `equipment_workload_equipment_idx`
  ON `equipment_workload_movements` (`organization_id`,`equipment_id`,`performed_at` DESC,`id` DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `staff_output_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `staff_email` text NOT NULL,
  `staff_role` text NOT NULL CHECK (`staff_role` IN ('radiologist','radiographer')),
  `study_count` integer DEFAULT 1 NOT NULL CHECK (`study_count` = 1),
  `anatomical_regions_count` integer NOT NULL CHECK (`anatomical_regions_count` BETWEEN 1 AND 20),
  `performed_at` text NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `staff_output_document_role_idx`
  ON `staff_output_movements` (`organization_id`,`document_id`,`staff_role`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `staff_output_staff_idx`
  ON `staff_output_movements` (`organization_id`,`staff_email`,`performed_at` DESC,`id` DESC);
--> statement-breakpoint

-- Exact snapshot integrity: the service act must describe the already-recorded execution fact.
CREATE TRIGGER IF NOT EXISTS `service_delivery_details_integrity_insert`
BEFORE INSERT ON `service_delivery_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='posted'
  ) THEN RAISE(ABORT,'service_delivery_document_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `bookings` b
    WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id
      AND b.performed_at<>'' AND b.performed_at=NEW.performed_at
      AND b.patient_id=NEW.patient_id
      AND b.service_code=NEW.service_code AND b.service=NEW.service_name
      AND b.patient_category=NEW.patient_category
      AND b.equipment_id=NEW.equipment_id AND b.duration_minutes=NEW.duration_minutes
      AND b.anatomical_regions_count=NEW.anatomical_regions_count
      AND b.assigned_radiologist_email=NEW.radiologist_email
      AND b.assigned_radiographer_email=NEW.radiographer_email
      AND NEW.charge_amount=CASE WHEN b.patient_category='civilian' THEN b.payment_amount ELSE 0 END
      AND NEW.currency='UAH'
  ) THEN RAISE(ABORT,'service_delivery_booking_mismatch') END;
  SELECT CASE WHEN NEW.radiologist_email<>'' AND NOT EXISTS (
    SELECT 1 FROM `memberships` m
    WHERE m.organization_id=NEW.organization_id AND m.member_email=NEW.radiologist_email AND m.role='radiologist'
  ) THEN RAISE(ABORT,'service_delivery_radiologist_tenant_mismatch') END;
  SELECT CASE WHEN NEW.radiographer_email<>'' AND NOT EXISTS (
    SELECT 1 FROM `memberships` m
    WHERE m.organization_id=NEW.organization_id AND m.member_email=NEW.radiographer_email AND m.role='radiographer'
  ) THEN RAISE(ABORT,'service_delivery_radiographer_tenant_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `service_delivery_details_no_update`
BEFORE UPDATE ON `service_delivery_details`
BEGIN SELECT RAISE(ABORT,'service_delivery_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `service_delivery_details_no_delete`
BEFORE DELETE ON `service_delivery_details`
BEGIN SELECT RAISE(ABORT,'service_delivery_immutable'); END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `revenue_service_delivery_integrity`
BEFORE INSERT ON `revenue_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='posted'
      AND s.booking_id=NEW.booking_id AND s.charge_amount>0
      AND NEW.movement_type='service_charge' AND NEW.amount_delta=s.charge_amount
      AND NEW.currency=s.currency AND NEW.service_code=s.service_code AND NEW.occurred_at=s.performed_at
  ) THEN RAISE(ABORT,'revenue_service_delivery_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `equipment_workload_service_delivery_integrity`
BEFORE INSERT ON `equipment_workload_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='posted'
      AND s.booking_id=NEW.booking_id AND NEW.equipment_id=s.equipment_id
      AND NEW.study_count=1 AND NEW.duration_minutes=s.duration_minutes
      AND NEW.anatomical_regions_count=s.anatomical_regions_count AND NEW.performed_at=s.performed_at
  ) THEN RAISE(ABORT,'equipment_workload_service_delivery_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_output_service_delivery_integrity`
BEFORE INSERT ON `staff_output_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='posted'
      AND s.booking_id=NEW.booking_id AND NEW.study_count=1
      AND NEW.anatomical_regions_count=s.anatomical_regions_count AND NEW.performed_at=s.performed_at
      AND (
        (NEW.staff_role='radiologist' AND NEW.staff_email=s.radiologist_email AND s.radiologist_email<>'')
        OR
        (NEW.staff_role='radiographer' AND NEW.staff_email=s.radiographer_email AND s.radiographer_email<>'')
      )
  ) THEN RAISE(ABORT,'staff_output_service_delivery_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `revenue_movements_no_update`
BEFORE UPDATE ON `revenue_movements`
BEGIN SELECT RAISE(ABORT,'revenue_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `revenue_movements_no_delete`
BEFORE DELETE ON `revenue_movements`
BEGIN SELECT RAISE(ABORT,'revenue_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `equipment_workload_movements_no_update`
BEFORE UPDATE ON `equipment_workload_movements`
BEGIN SELECT RAISE(ABORT,'equipment_workload_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `equipment_workload_movements_no_delete`
BEFORE DELETE ON `equipment_workload_movements`
BEGIN SELECT RAISE(ABORT,'equipment_workload_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_output_movements_no_update`
BEFORE UPDATE ON `staff_output_movements`
BEGIN SELECT RAISE(ABORT,'staff_output_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_output_movements_no_delete`
BEFORE DELETE ON `staff_output_movements`
BEGIN SELECT RAISE(ABORT,'staff_output_movement_immutable'); END;
--> statement-breakpoint

-- 0063 originally guarded all patient settlement inserts as finance payment/refund movements.
-- Narrow that guard and add the service-delivery charge contract explicitly.
DROP TRIGGER IF EXISTS `patient_settlement_finance_integrity`;
--> statement-breakpoint
CREATE TRIGGER `patient_settlement_finance_integrity`
BEFORE INSERT ON `patient_settlement_movements`
WHEN NEW.movement_type IN ('payment','refund')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `finance_document_details` f
      ON f.document_id=d.id AND f.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
      AND f.booking_id=NEW.booking_id
      AND f.patient_id=NEW.patient_id
      AND f.currency=NEW.currency
      AND (
        (d.document_type='payment' AND NEW.movement_type='payment' AND NEW.amount_delta=-f.amount)
        OR
        (d.document_type='refund' AND NEW.movement_type='refund' AND NEW.amount_delta=f.amount)
      )
  ) THEN RAISE(ABORT,'patient_settlement_document_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_settlement_service_delivery_integrity`
BEFORE INSERT ON `patient_settlement_movements`
WHEN NEW.movement_type='charge'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='posted'
      AND s.booking_id=NEW.booking_id AND s.patient_id=NEW.patient_id
      AND s.currency=NEW.currency AND s.charge_amount>0 AND NEW.amount_delta=s.charge_amount
  ) THEN RAISE(ABORT,'patient_settlement_service_delivery_mismatch') END;
END;
--> statement-breakpoint

-- Once an act exists, the economic/execution snapshot is immutable through ordinary booking edits.
CREATE TRIGGER IF NOT EXISTS `booking_service_delivery_fact_immutable`
BEFORE UPDATE OF `performed_at`,`service_code`,`service`,`payment_amount`,`patient_category`,`equipment_id`,
  `duration_minutes`,`anatomical_regions_count`,`assigned_radiologist_email`,`assigned_radiographer_email`
ON `bookings`
WHEN EXISTS (
  SELECT 1 FROM `service_delivery_details` s
  JOIN `business_documents` d ON d.id=s.document_id AND d.organization_id=s.organization_id
  WHERE s.organization_id=OLD.organization_id AND s.booking_id=OLD.id AND d.state='posted'
)
BEGIN
  SELECT CASE WHEN
    NEW.performed_at<>OLD.performed_at OR NEW.service_code<>OLD.service_code OR NEW.service<>OLD.service
    OR NEW.payment_amount<>OLD.payment_amount OR NEW.patient_category<>OLD.patient_category
    OR NEW.equipment_id<>OLD.equipment_id OR NEW.duration_minutes<>OLD.duration_minutes
    OR NEW.anatomical_regions_count<>OLD.anatomical_regions_count
    OR NEW.assigned_radiologist_email<>OLD.assigned_radiologist_email
    OR NEW.assigned_radiographer_email<>OLD.assigned_radiographer_email
  THEN RAISE(ABORT,'service_delivery_booking_fact_immutable') END;
END;
--> statement-breakpoint

-- Canonical registrar: only an explicit execution_recorded event for a booking with performed_at creates the act.
-- Duplicate execution events are idempotent because service_delivery_details owns a unique booking claim.
CREATE TRIGGER IF NOT EXISTS `booking_execution_posts_service_delivery`
AFTER INSERT ON `booking_events`
WHEN NEW.action='execution_recorded'
  AND EXISTS (
    SELECT 1 FROM `bookings` b
    WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id AND b.performed_at<>''
  )
  AND NOT EXISTS (
    SELECT 1 FROM `service_delivery_details` s
    WHERE s.organization_id=NEW.organization_id AND s.booking_id=NEW.booking_id
  )
BEGIN
  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,`created_by`,`posted_by`,`posted_at`)
  SELECT b.organization_id,'service_delivery','АКТ-' || printf('%06d',b.id),b.performed_at,'posted',
         'Надання послуги ' || b.service_code,
         CASE WHEN NEW.actor<>'' THEN NEW.actor ELSE 'system:execution' END,
         CASE WHEN NEW.actor<>'' THEN NEW.actor ELSE 'system:execution' END,
         CURRENT_TIMESTAMP
  FROM `bookings` b
  WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id AND b.performed_at<>'';

  INSERT INTO `service_delivery_details`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`service_code`,`service_name`,`patient_category`,
     `charge_amount`,`currency`,`equipment_id`,`duration_minutes`,`performed_at`,`anatomical_regions_count`,
     `radiologist_email`,`radiographer_email`)
  SELECT b.organization_id,d.id,b.id,b.patient_id,b.service_code,b.service,b.patient_category,
         CASE WHEN b.patient_category='civilian' THEN b.payment_amount ELSE 0 END,'UAH',
         b.equipment_id,b.duration_minutes,b.performed_at,b.anatomical_regions_count,
         b.assigned_radiologist_email,b.assigned_radiographer_email
  FROM `bookings` b
  JOIN `business_documents` d
    ON d.organization_id=b.organization_id AND d.document_type='service_delivery'
   AND d.number='АКТ-' || printf('%06d',b.id)
  WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id;

  INSERT INTO `revenue_movements`
    (`organization_id`,`document_id`,`booking_id`,`movement_type`,`amount_delta`,`currency`,`service_code`,`actor_email`,`occurred_at`)
  SELECT s.organization_id,s.document_id,s.booking_id,'service_charge',s.charge_amount,s.currency,s.service_code,
         CASE WHEN NEW.actor<>'' THEN NEW.actor ELSE 'system:execution' END,s.performed_at
  FROM `service_delivery_details` s
  WHERE s.organization_id=NEW.organization_id AND s.booking_id=NEW.booking_id AND s.charge_amount>0;

  INSERT INTO `patient_settlement_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`movement_type`,`amount_delta`,`currency`,`actor_email`,`occurred_at`)
  SELECT s.organization_id,s.document_id,s.booking_id,s.patient_id,'charge',s.charge_amount,s.currency,
         CASE WHEN NEW.actor<>'' THEN NEW.actor ELSE 'system:execution' END,s.performed_at
  FROM `service_delivery_details` s
  WHERE s.organization_id=NEW.organization_id AND s.booking_id=NEW.booking_id AND s.charge_amount>0;

  INSERT INTO `equipment_workload_movements`
    (`organization_id`,`document_id`,`booking_id`,`equipment_id`,`study_count`,`duration_minutes`,`anatomical_regions_count`,`performed_at`)
  SELECT s.organization_id,s.document_id,s.booking_id,s.equipment_id,1,s.duration_minutes,s.anatomical_regions_count,s.performed_at
  FROM `service_delivery_details` s
  WHERE s.organization_id=NEW.organization_id AND s.booking_id=NEW.booking_id;

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`staff_email`,`staff_role`,`study_count`,`anatomical_regions_count`,`performed_at`)
  SELECT s.organization_id,s.document_id,s.booking_id,s.radiologist_email,'radiologist',1,s.anatomical_regions_count,s.performed_at
  FROM `service_delivery_details` s
  WHERE s.organization_id=NEW.organization_id AND s.booking_id=NEW.booking_id AND s.radiologist_email<>'';

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`staff_email`,`staff_role`,`study_count`,`anatomical_regions_count`,`performed_at`)
  SELECT s.organization_id,s.document_id,s.booking_id,s.radiographer_email,'radiographer',1,s.anatomical_regions_count,s.performed_at
  FROM `service_delivery_details` s
  WHERE s.organization_id=NEW.organization_id AND s.booking_id=NEW.booking_id AND s.radiographer_email<>'';
END;