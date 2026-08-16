-- BAS commercial root: every new booking receives one Patient Order (Замовлення пацієнта).
-- Historical bookings are deliberately NOT backfilled: no retrospective business facts are invented.

ALTER TABLE `business_documents` ADD COLUMN `basis_document_id` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `business_documents_basis_idx`
  ON `business_documents` (`organization_id`,`basis_document_id`,`id`)
  WHERE `basis_document_id` IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `patient_order_details` (
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `patient_id` text DEFAULT '' NOT NULL,
  `patient_category` text DEFAULT '' NOT NULL,
  `service_code` text NOT NULL,
  `service_title` text NOT NULL,
  `equipment_id` text NOT NULL,
  `duration_minutes` integer NOT NULL CHECK (`duration_minutes` > 0),
  `price_amount` integer DEFAULT 0 NOT NULL CHECK (`price_amount` >= 0),
  `charge_amount` integer DEFAULT 0 NOT NULL CHECK (`charge_amount` >= 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`document_id`),
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `patient_order_booking_unique`
  ON `patient_order_details` (`organization_id`,`booking_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_order_patient_idx`
  ON `patient_order_details` (`organization_id`,`patient_id`,`document_id` DESC);
--> statement-breakpoint

-- Generic basis is part of document identity and must remain inside the tenant.
CREATE TRIGGER IF NOT EXISTS `business_document_basis_tenant_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.basis_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'business_document_basis_tenant_mismatch') END;
  SELECT CASE WHEN NEW.id IS NOT NULL AND NEW.id=NEW.basis_document_id
    THEN RAISE(ABORT,'business_document_basis_self_reference') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `business_document_basis_tenant_update`
BEFORE UPDATE OF `basis_document_id`,`organization_id` ON `business_documents`
WHEN NEW.basis_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'business_document_basis_tenant_mismatch') END;
  SELECT CASE WHEN NEW.id=NEW.basis_document_id
    THEN RAISE(ABORT,'business_document_basis_self_reference') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `business_document_basis_type_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.basis_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.document_type='payment' AND NOT EXISTS (
    SELECT 1 FROM business_documents src WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id AND src.document_type='patient_order'
  ) THEN RAISE(ABORT,'payment_basis_must_be_patient_order') END;
  SELECT CASE WHEN NEW.document_type='refund' AND NOT EXISTS (
    SELECT 1 FROM business_documents src WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id AND src.document_type='payment'
  ) THEN RAISE(ABORT,'refund_basis_must_be_payment') END;
  SELECT CASE WHEN NEW.document_type='service_delivery' AND NOT EXISTS (
    SELECT 1 FROM business_documents src WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id AND src.document_type IN ('patient_order','service_delivery')
  ) THEN RAISE(ABORT,'service_delivery_basis_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `business_document_basis_type_update`
BEFORE UPDATE OF `basis_document_id`,`document_type`,`organization_id` ON `business_documents`
WHEN NEW.basis_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.document_type='payment' AND NOT EXISTS (
    SELECT 1 FROM business_documents src WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id AND src.document_type='patient_order'
  ) THEN RAISE(ABORT,'payment_basis_must_be_patient_order') END;
  SELECT CASE WHEN NEW.document_type='refund' AND NOT EXISTS (
    SELECT 1 FROM business_documents src WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id AND src.document_type='payment'
  ) THEN RAISE(ABORT,'refund_basis_must_be_payment') END;
  SELECT CASE WHEN NEW.document_type='service_delivery' AND NOT EXISTS (
    SELECT 1 FROM business_documents src WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id AND src.document_type IN ('patient_order','service_delivery')
  ) THEN RAISE(ABORT,'service_delivery_basis_invalid') END;
END;
--> statement-breakpoint

-- basis_document_id and reversed_document_id are immutable evidence after posting too.
DROP TRIGGER IF EXISTS `business_documents_immutable_after_draft`;
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

-- Patient-order details are an exact mutable snapshot only while the order is draft.
CREATE TRIGGER IF NOT EXISTS `patient_order_details_integrity_insert`
BEFORE INSERT ON `patient_order_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='patient_order' AND d.state='draft' AND d.basis_document_id IS NULL
  ) THEN RAISE(ABORT,'patient_order_document_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id
      AND b.patient_id=NEW.patient_id
      AND b.patient_category=NEW.patient_category
      AND b.service_code=NEW.service_code
      AND b.service=NEW.service_title
      AND b.equipment_id=NEW.equipment_id
      AND b.duration_minutes=NEW.duration_minutes
      AND b.payment_amount=NEW.price_amount
      AND NEW.charge_amount=CASE WHEN b.patient_category='civilian' THEN b.payment_amount ELSE 0 END
  ) THEN RAISE(ABORT,'patient_order_booking_snapshot_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_order_details_integrity_update`
BEFORE UPDATE ON `patient_order_details`
BEGIN
  SELECT CASE WHEN NEW.organization_id<>OLD.organization_id OR NEW.document_id<>OLD.document_id OR NEW.booking_id<>OLD.booking_id
    THEN RAISE(ABORT,'patient_order_identity_immutable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id
      AND d.document_type='patient_order' AND d.state='draft'
  ) THEN RAISE(ABORT,'patient_order_not_draft') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id
      AND b.patient_id=NEW.patient_id
      AND b.patient_category=NEW.patient_category
      AND b.service_code=NEW.service_code
      AND b.service=NEW.service_title
      AND b.equipment_id=NEW.equipment_id
      AND b.duration_minutes=NEW.duration_minutes
      AND b.payment_amount=NEW.price_amount
      AND NEW.charge_amount=CASE WHEN b.patient_category='civilian' THEN b.payment_amount ELSE 0 END
  ) THEN RAISE(ABORT,'patient_order_booking_snapshot_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_order_details_no_delete_posted`
BEFORE DELETE ON `patient_order_details`
WHEN NOT EXISTS (
  SELECT 1 FROM business_documents d
  WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft'
)
BEGIN SELECT RAISE(ABORT,'patient_order_not_draft'); END;
--> statement-breakpoint

-- Every new booking gets exactly one draft Patient Order. Existing bookings are untouched by migration.
CREATE TRIGGER IF NOT EXISTS `booking_patient_order_auto_create`
AFTER INSERT ON `bookings`
WHEN NOT EXISTS (
  SELECT 1 FROM patient_order_details o WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.id
)
BEGIN
  INSERT INTO business_documents
    (organization_id,document_type,number,occurred_at,state,comment,created_by)
  VALUES (
    NEW.organization_id,'patient_order','',NEW.created_at,'draft',
    'Автоматично з заявки '||NEW.code,'system:booking'
  );
  UPDATE business_documents
  SET number=printf('ЗП-%06d',id)
  WHERE id=last_insert_rowid() AND organization_id=NEW.organization_id
    AND document_type='patient_order' AND state='draft' AND number='';
  INSERT INTO patient_order_details
    (organization_id,document_id,booking_id,patient_id,patient_category,service_code,service_title,
     equipment_id,duration_minutes,price_amount,charge_amount,currency)
  VALUES (
    NEW.organization_id,last_insert_rowid(),NEW.id,NEW.patient_id,NEW.patient_category,
    NEW.service_code,NEW.service,NEW.equipment_id,NEW.duration_minutes,NEW.payment_amount,
    CASE WHEN NEW.patient_category='civilian' THEN NEW.payment_amount ELSE 0 END,'UAH'
  );
END;
--> statement-breakpoint

-- Before the first downstream economic fact, booking changes keep the draft order snapshot in sync.
CREATE TRIGGER IF NOT EXISTS `booking_patient_order_sync_draft`
AFTER UPDATE OF `patient_id`,`patient_category`,`service`,`service_code`,`equipment_id`,`duration_minutes`,`payment_amount`
ON `bookings`
WHEN EXISTS (
  SELECT 1 FROM patient_order_details o
  JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
  WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.id AND d.state='draft'
)
BEGIN
  UPDATE patient_order_details
  SET patient_id=NEW.patient_id,
      patient_category=NEW.patient_category,
      service_code=NEW.service_code,
      service_title=NEW.service,
      equipment_id=NEW.equipment_id,
      duration_minutes=NEW.duration_minutes,
      price_amount=NEW.payment_amount,
      charge_amount=CASE WHEN NEW.patient_category='civilian' THEN NEW.payment_amount ELSE 0 END
  WHERE organization_id=NEW.organization_id AND booking_id=NEW.id;
END;
--> statement-breakpoint

-- Completion freezes/posts the order before the service-delivery AFTER trigger runs.
CREATE TRIGGER IF NOT EXISTS `booking_patient_order_post_before_completion`
BEFORE UPDATE OF `status`,`performed_at` ON `bookings`
WHEN NEW.status='completed' AND NEW.performed_at<>''
  AND EXISTS (
    SELECT 1 FROM patient_order_details o
    JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
    WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.id AND d.state='draft'
  )
BEGIN
  UPDATE patient_order_details
  SET patient_id=NEW.patient_id,
      patient_category=NEW.patient_category,
      service_code=NEW.service_code,
      service_title=NEW.service,
      equipment_id=NEW.equipment_id,
      duration_minutes=NEW.duration_minutes,
      price_amount=NEW.payment_amount,
      charge_amount=CASE WHEN NEW.patient_category='civilian' THEN NEW.payment_amount ELSE 0 END
  WHERE organization_id=NEW.organization_id AND booking_id=NEW.id;

  UPDATE business_documents
  SET state='posted',posted_by='system:execution',posted_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id AND document_type='patient_order' AND state='draft'
    AND id=(SELECT document_id FROM patient_order_details WHERE organization_id=NEW.organization_id AND booking_id=NEW.id LIMIT 1);
END;
--> statement-breakpoint

-- Once the order is posted, its commercial terms cannot drift through later booking edits.
CREATE TRIGGER IF NOT EXISTS `booking_posted_patient_order_terms_immutable`
BEFORE UPDATE OF `patient_category`,`service`,`service_code`,`equipment_id`,`duration_minutes`,`payment_amount`
ON `bookings`
WHEN EXISTS (
  SELECT 1 FROM patient_order_details o
  JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
  WHERE o.organization_id=OLD.organization_id AND o.booking_id=OLD.id AND d.state='posted'
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
--> statement-breakpoint

-- A paid booking posts/freezes its order in the same finance posting transaction.
CREATE TRIGGER IF NOT EXISTS `payment_posts_patient_order`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.state='draft' AND NEW.state='posted' AND NEW.document_type='payment' AND NEW.basis_document_id IS NOT NULL
BEGIN
  UPDATE business_documents
  SET state='posted',posted_by=NEW.posted_by,posted_at=NEW.posted_at
  WHERE id=NEW.basis_document_id AND organization_id=NEW.organization_id
    AND document_type='patient_order' AND state='draft';
END;
--> statement-breakpoint

-- New service-delivery documents created automatically from completed bookings carry the Patient Order as basis.
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
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,`created_by`,`basis_document_id`)
  VALUES (
    NEW.organization_id,'service_delivery','',NEW.performed_at,'draft',
    'Автоматично з факту виконання дослідження','system:execution',
    (SELECT o.document_id FROM patient_order_details o
     WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.id LIMIT 1)
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

  INSERT INTO `services_delivered_movements`
    (`organization_id`,`document_id`,`booking_id`,`patient_id`,`service_code`,`equipment_id`,`quantity`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.patient_id,NEW.service_code,NEW.equipment_id,1,
         NEW.anatomical_regions_count,NEW.performed_at,'system:execution',NEW.performed_at
  FROM `business_documents` d
  JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND s.booking_id=NEW.id AND d.state='posted';

  INSERT INTO `equipment_load_movements`
    (`organization_id`,`document_id`,`booking_id`,`equipment_id`,`minutes_delta`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.equipment_id,NEW.duration_minutes,NEW.performed_at,
         'system:execution',NEW.performed_at
  FROM `business_documents` d
  JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND s.booking_id=NEW.id AND d.state='posted';

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

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`member_email`,`staff_role`,`units_delta`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.assigned_radiologist_email,'radiologist',1,
         NEW.anatomical_regions_count,NEW.performed_at,'system:execution',NEW.performed_at
  FROM `business_documents` d
  JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND s.booking_id=NEW.id AND d.state='posted'
    AND NEW.assigned_radiologist_email<>'';

  INSERT INTO `staff_output_movements`
    (`organization_id`,`document_id`,`booking_id`,`member_email`,`staff_role`,`units_delta`,
     `anatomical_regions_count`,`performed_at`,`actor_email`,`occurred_at`)
  SELECT NEW.organization_id,d.id,NEW.id,NEW.assigned_radiographer_email,'radiographer',1,
         NEW.anatomical_regions_count,NEW.performed_at,'system:execution',NEW.performed_at
  FROM `business_documents` d
  JOIN `service_delivery_details` s ON s.document_id=d.id AND s.organization_id=d.organization_id
  WHERE d.organization_id=NEW.organization_id AND d.document_type='service_delivery'
    AND s.booking_id=NEW.id AND d.state='posted'
    AND NEW.assigned_radiographer_email<>'';
END;
