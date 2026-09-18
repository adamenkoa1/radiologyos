CREATE TABLE `appointment_details` (
	`organization_id` integer NOT NULL,
	`document_id` integer PRIMARY KEY NOT NULL,
	`booking_id` integer NOT NULL,
	`appointment_version` integer NOT NULL,
	`patient_id` text DEFAULT '' NOT NULL,
	`service_code` text NOT NULL,
	`service_title` text NOT NULL,
	`equipment_id` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`scheduled_date` text NOT NULL,
	`scheduled_time` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "appointment_details_check_1" CHECK(`appointment_version` > 0),
	CONSTRAINT "appointment_details_check_2" CHECK(`duration_minutes` > 0),
	CONSTRAINT "appointment_details_check_3" CHECK(length(trim(`scheduled_date`)) > 0),
	CONSTRAINT "appointment_details_check_4" CHECK(length(trim(`scheduled_time`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_booking_version_unique` ON `appointment_details` (`organization_id`,`booking_id`,`appointment_version`);--> statement-breakpoint
CREATE INDEX `appointment_booking_history_idx` ON `appointment_details` (`organization_id`,`booking_id`,`appointment_version`,`document_id`);
--> statement-breakpoint

-- Appointment is an immutable scheduling fact. The mutable booking remains the operational
-- projection; only future bookings receive appointment history. Existing bookings are not backfilled.

CREATE TRIGGER `appointment_document_integrity_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.document_type='appointment'
BEGIN
  SELECT CASE WHEN NEW.state<>'posted'
    THEN RAISE(ABORT,'appointment_must_be_posted') END;
  SELECT CASE WHEN NEW.created_by<>'system:schedule' OR NEW.posted_by<>'system:schedule'
    THEN RAISE(ABORT,'appointment_actor_invalid') END;
  SELECT CASE WHEN NEW.posted_at='' OR NEW.occurred_at='' OR NEW.posted_at<>NEW.occurred_at
    THEN RAISE(ABORT,'appointment_timestamp_invalid') END;
  SELECT CASE WHEN NEW.comment<>'Автоматично з планування заявки'
    THEN RAISE(ABORT,'appointment_comment_invalid') END;
  SELECT CASE WHEN NEW.reversed_document_id IS NOT NULL OR NEW.basis_document_id IS NULL
    THEN RAISE(ABORT,'appointment_basis_invalid') END;

  SELECT CASE WHEN NOT (
    -- First appointment: exact Patient Order root, no earlier appointment history.
    EXISTS (
      SELECT 1
      FROM `patient_order_details` o
      JOIN `business_documents` root
        ON root.id=o.document_id AND root.organization_id=o.organization_id
      JOIN `bookings` b
        ON b.id=o.booking_id AND b.organization_id=o.organization_id
      WHERE o.organization_id=NEW.organization_id
        AND o.document_id=NEW.basis_document_id
        AND root.document_type='patient_order'
        AND b.status<>'cancelled'
        AND NEW.number=printf('АП-%06d-%03d',o.booking_id,1)
        AND NOT EXISTS (
          SELECT 1 FROM `appointment_details` x
          WHERE x.organization_id=o.organization_id AND x.booking_id=o.booking_id
        )
    )
    OR
    -- Reschedule: previous appointment is the exact latest reversed version and no active version remains.
    EXISTS (
      SELECT 1
      FROM `appointment_details` prev
      JOIN `business_documents` pd
        ON pd.id=prev.document_id AND pd.organization_id=prev.organization_id
      JOIN `bookings` b
        ON b.id=prev.booking_id AND b.organization_id=prev.organization_id
      WHERE prev.organization_id=NEW.organization_id
        AND prev.document_id=NEW.basis_document_id
        AND pd.document_type='appointment' AND pd.state='reversed'
        AND b.status<>'cancelled'
        AND prev.appointment_version=(
          SELECT MAX(x.appointment_version) FROM `appointment_details` x
          WHERE x.organization_id=prev.organization_id AND x.booking_id=prev.booking_id
        )
        AND NEW.number=printf('АП-%06d-%03d',prev.booking_id,prev.appointment_version+1)
        AND NOT EXISTS (
          SELECT 1
          FROM `appointment_details` active
          JOIN `business_documents` ad
            ON ad.id=active.document_id AND ad.organization_id=active.organization_id
          WHERE active.organization_id=prev.organization_id AND active.booking_id=prev.booking_id
            AND ad.document_type='appointment' AND ad.state='posted'
        )
    )
  ) THEN RAISE(ABORT,'appointment_basis_or_version_invalid') END;
END;
--> statement-breakpoint

-- Details are generated only from the validated business document and current canonical booking.
CREATE TRIGGER `appointment_details_from_document`
AFTER INSERT ON `business_documents`
WHEN NEW.document_type='appointment'
BEGIN
  INSERT INTO `appointment_details`
    (`organization_id`,`document_id`,`booking_id`,`appointment_version`,`patient_id`,
     `service_code`,`service_title`,`equipment_id`,`duration_minutes`,`scheduled_date`,`scheduled_time`)
  SELECT NEW.organization_id,NEW.id,b.id,
         CASE WHEN root.document_id IS NOT NULL THEN 1 ELSE prev.appointment_version+1 END,
         b.patient_id,b.service_code,b.service,b.equipment_id,b.duration_minutes,b.desired_date,b.desired_time
  FROM `bookings` b
  LEFT JOIN `patient_order_details` root
    ON root.organization_id=NEW.organization_id AND root.booking_id=b.id
   AND root.document_id=NEW.basis_document_id
  LEFT JOIN `appointment_details` prev
    ON prev.organization_id=NEW.organization_id AND prev.booking_id=b.id
   AND prev.document_id=NEW.basis_document_id
  WHERE b.organization_id=NEW.organization_id
    AND (root.document_id IS NOT NULL OR prev.document_id IS NOT NULL)
  LIMIT 1;
END;
--> statement-breakpoint

CREATE TRIGGER `appointment_details_integrity_insert`
BEFORE INSERT ON `appointment_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `bookings` b
      ON b.id=NEW.booking_id AND b.organization_id=NEW.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='appointment' AND d.state='posted'
      AND d.created_by='system:schedule' AND d.posted_by='system:schedule'
      AND d.number=printf('АП-%06d-%03d',NEW.booking_id,NEW.appointment_version)
      AND b.patient_id=NEW.patient_id
      AND b.service_code=NEW.service_code
      AND b.service=NEW.service_title
      AND b.equipment_id=NEW.equipment_id
      AND b.duration_minutes=NEW.duration_minutes
      AND b.desired_date=NEW.scheduled_date
      AND b.desired_time=NEW.scheduled_time
      AND (
        (NEW.appointment_version=1 AND EXISTS (
          SELECT 1 FROM `patient_order_details` o
          WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
            AND o.document_id=d.basis_document_id
        ))
        OR
        (NEW.appointment_version>1 AND EXISTS (
          SELECT 1
          FROM `appointment_details` prev
          JOIN `business_documents` pd
            ON pd.id=prev.document_id AND pd.organization_id=prev.organization_id
          WHERE prev.organization_id=NEW.organization_id AND prev.booking_id=NEW.booking_id
            AND prev.document_id=d.basis_document_id
            AND prev.appointment_version=NEW.appointment_version-1
            AND pd.document_type='appointment' AND pd.state='reversed'
        ))
      )
  ) THEN RAISE(ABORT,'appointment_snapshot_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `appointment_details_no_update`
BEFORE UPDATE ON `appointment_details`
BEGIN SELECT RAISE(ABORT,'appointment_snapshot_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_details_no_delete`
BEFORE DELETE ON `appointment_details`
BEGIN SELECT RAISE(ABORT,'appointment_snapshot_immutable'); END;
--> statement-breakpoint

-- A posted appointment may be reversed only because the booking was cancelled or its current
-- scheduling snapshot changed. Direct independent reversal while the booking is unchanged is rejected.
CREATE TRIGGER `appointment_reversal_requires_booking_transition`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='appointment' AND OLD.state='posted' AND NEW.state='reversed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `appointment_details` a
    JOIN `bookings` b ON b.id=a.booking_id AND b.organization_id=a.organization_id
    WHERE a.document_id=OLD.id AND a.organization_id=OLD.organization_id
      AND (
        b.status='cancelled'
        OR b.patient_id IS NOT a.patient_id
        OR b.service_code IS NOT a.service_code
        OR b.service IS NOT a.service_title
        OR b.equipment_id IS NOT a.equipment_id
        OR b.duration_minutes IS NOT a.duration_minutes
        OR b.desired_date IS NOT a.scheduled_date
        OR b.desired_time IS NOT a.scheduled_time
      )
  ) THEN RAISE(ABORT,'appointment_reversal_requires_booking_transition') END;
END;
--> statement-breakpoint

-- Future booking path: Patient Order creation is the deterministic sequencing hook for Appointment v1.
CREATE TRIGGER `patient_order_appointment_auto_create`
AFTER INSERT ON `patient_order_details`
WHEN EXISTS (
  SELECT 1 FROM `bookings` b
  WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id AND b.status<>'cancelled'
)
AND NOT EXISTS (
  SELECT 1 FROM `appointment_details` a
  WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.booking_id
)
BEGIN
  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,
     `created_by`,`posted_by`,`posted_at`,`basis_document_id`)
  VALUES (
    NEW.organization_id,'appointment',printf('АП-%06d-%03d',NEW.booking_id,1),
    CURRENT_TIMESTAMP,'posted','Автоматично з планування заявки',
    'system:schedule','system:schedule',CURRENT_TIMESTAMP,NEW.document_id
  );
END;
--> statement-breakpoint

-- Only bookings that already have appointment history participate. This is the no-backfill boundary:
-- legacy rows remain on the legacy scheduling path even when they receive unrelated updates.
CREATE TRIGGER `booking_appointment_reschedule`
AFTER UPDATE OF `patient_id`,`service`,`service_code`,`equipment_id`,`duration_minutes`,`desired_date`,`desired_time`
ON `bookings`
WHEN NEW.status<>'cancelled'
  AND (
    NEW.patient_id IS NOT OLD.patient_id
    OR NEW.service IS NOT OLD.service
    OR NEW.service_code IS NOT OLD.service_code
    OR NEW.equipment_id IS NOT OLD.equipment_id
    OR NEW.duration_minutes IS NOT OLD.duration_minutes
    OR NEW.desired_date IS NOT OLD.desired_date
    OR NEW.desired_time IS NOT OLD.desired_time
  )
  AND EXISTS (
    SELECT 1
    FROM `appointment_details` a
    JOIN `business_documents` d ON d.id=a.document_id AND d.organization_id=a.organization_id
    WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.id
      AND d.document_type='appointment' AND d.state='posted'
  )
BEGIN
  UPDATE `business_documents`
  SET state='reversed'
  WHERE organization_id=NEW.organization_id AND document_type='appointment' AND state='posted'
    AND id=(
      SELECT a.document_id
      FROM `appointment_details` a
      JOIN `business_documents` d ON d.id=a.document_id AND d.organization_id=a.organization_id
      WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.id
        AND d.document_type='appointment' AND d.state='posted'
      ORDER BY a.appointment_version DESC LIMIT 1
    );

  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,
     `created_by`,`posted_by`,`posted_at`,`basis_document_id`)
  SELECT NEW.organization_id,'appointment',printf('АП-%06d-%03d',NEW.id,prev.appointment_version+1),
         CURRENT_TIMESTAMP,'posted','Автоматично з планування заявки',
         'system:schedule','system:schedule',CURRENT_TIMESTAMP,prev.document_id
  FROM `appointment_details` prev
  JOIN `business_documents` pd ON pd.id=prev.document_id AND pd.organization_id=prev.organization_id
  WHERE prev.organization_id=NEW.organization_id AND prev.booking_id=NEW.id
    AND pd.document_type='appointment' AND pd.state='reversed'
  ORDER BY prev.appointment_version DESC
  LIMIT 1;
END;
--> statement-breakpoint

CREATE TRIGGER `booking_appointment_cancel`
AFTER UPDATE OF `status` ON `bookings`
WHEN OLD.status<>'cancelled' AND NEW.status='cancelled'
  AND EXISTS (
    SELECT 1
    FROM `appointment_details` a
    JOIN `business_documents` d ON d.id=a.document_id AND d.organization_id=a.organization_id
    WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.id
      AND d.document_type='appointment' AND d.state='posted'
  )
BEGIN
  UPDATE `business_documents`
  SET state='reversed'
  WHERE organization_id=NEW.organization_id AND document_type='appointment' AND state='posted'
    AND id=(
      SELECT a.document_id
      FROM `appointment_details` a
      JOIN `business_documents` d ON d.id=a.document_id AND d.organization_id=a.organization_id
      WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.id
        AND d.document_type='appointment' AND d.state='posted'
      ORDER BY a.appointment_version DESC LIMIT 1
    );
END;
--> statement-breakpoint
