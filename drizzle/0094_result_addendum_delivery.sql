CREATE TABLE `result_addendum_delivery_details` (
	`organization_id` integer NOT NULL,
	`document_id` integer PRIMARY KEY NOT NULL,
	`addendum_id` text NOT NULL,
	`booking_id` integer NOT NULL,
	`patient_id` text DEFAULT '' NOT NULL,
	`service_title` text NOT NULL,
	`base_protocol_number` text NOT NULL,
	`base_protocol_version` integer NOT NULL,
	`addendum_version` integer NOT NULL,
	`signed_by` text NOT NULL,
	`signed_at` text NOT NULL,
	`delivered_by` text NOT NULL,
	`delivered_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`addendum_id`) REFERENCES `protocol_addenda`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "result_addendum_delivery_details_check_1" CHECK(`base_protocol_version` > 0),
	CONSTRAINT "result_addendum_delivery_details_check_2" CHECK(`addendum_version` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_addendum_delivery_addendum_unique` ON `result_addendum_delivery_details` (`organization_id`,`addendum_id`);--> statement-breakpoint
CREATE INDEX `result_addendum_delivery_booking_idx` ON `result_addendum_delivery_details` (`organization_id`,`booking_id`,`document_id`);--> statement-breakpoint
CREATE INDEX `result_addendum_delivery_document_idx` ON `result_addendum_delivery_details` (`organization_id`,`document_id`);
--> statement-breakpoint

-- Extend result_delivery integrity to support the addendum-delivery subtype while preserving
-- the existing base-protocol delivery contract.
DROP TRIGGER IF EXISTS `result_delivery_document_integrity_insert`;
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
  SELECT CASE WHEN NEW.comment NOT IN ('Видача результату пацієнту','Видача виправлення до протоколу пацієнту')
    THEN RAISE(ABORT,'result_delivery_comment_invalid') END;

  SELECT CASE WHEN NOT (
    (
      NEW.comment='Видача результату пацієнту'
      AND EXISTS (
        SELECT 1
        FROM `protocols` p
        JOIN `bookings` b ON b.id=p.booking_id AND b.organization_id=p.organization_id
        WHERE p.organization_id=NEW.organization_id
          AND p.status='issued'
          AND p.signed_by<>'' AND p.signed_at<>'' AND p.signed_version=p.version
          AND NEW.number=printf('ВР-%06d',p.booking_id)
          AND (
            (NEW.basis_document_id IS NULL AND NOT EXISTS (
              SELECT 1 FROM `business_documents` perf
              JOIN `business_documents` src ON src.id=perf.basis_document_id AND src.organization_id=perf.organization_id
              JOIN `service_delivery_details` s ON s.document_id=src.id AND s.organization_id=src.organization_id
              WHERE perf.organization_id=NEW.organization_id
                AND perf.document_type='study_performance' AND perf.state='posted'
                AND src.document_type='service_delivery' AND s.booking_id=p.booking_id
            ))
            OR NEW.basis_document_id=(
              SELECT perf.id FROM `business_documents` perf
              JOIN `business_documents` src ON src.id=perf.basis_document_id AND src.organization_id=perf.organization_id
              JOIN `service_delivery_details` s ON s.document_id=src.id AND s.organization_id=src.organization_id
              WHERE perf.organization_id=NEW.organization_id
                AND perf.document_type='study_performance' AND perf.state='posted'
                AND src.document_type='service_delivery' AND s.booking_id=p.booking_id
              ORDER BY perf.id DESC LIMIT 1
            )
          )
      )
    )
    OR
    (
      NEW.comment='Видача виправлення до протоколу пацієнту'
      AND EXISTS (
        SELECT 1
        FROM `protocol_addenda` a
        JOIN `protocols` p
          ON p.organization_id=a.organization_id AND p.booking_id=a.booking_id
         AND p.version=a.base_protocol_version AND p.status='issued'
        JOIN `bookings` b ON b.id=a.booking_id AND b.organization_id=a.organization_id
        WHERE a.organization_id=NEW.organization_id
          AND a.status='issued'
          AND a.signed_by<>'' AND a.signed_at<>'' AND a.signed_version=a.version
          AND NEW.number='ВК-'||a.id
          AND (
            (NEW.basis_document_id IS NULL AND NOT EXISTS (
              SELECT 1 FROM `result_delivery_details` rd
              WHERE rd.organization_id=a.organization_id AND rd.booking_id=a.booking_id
            ))
            OR NEW.basis_document_id=(
              SELECT rd.document_id FROM `result_delivery_details` rd
              WHERE rd.organization_id=a.organization_id AND rd.booking_id=a.booking_id
              LIMIT 1
            )
          )
      )
    )
  ) THEN RAISE(ABORT,'result_delivery_protocol_or_basis_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `result_addendum_delivery_details_from_document`
AFTER INSERT ON `business_documents`
WHEN NEW.document_type='result_delivery' AND NEW.comment='Видача виправлення до протоколу пацієнту'
BEGIN
  INSERT INTO `result_addendum_delivery_details`
    (`organization_id`,`document_id`,`addendum_id`,`booking_id`,`patient_id`,`service_title`,
     `base_protocol_number`,`base_protocol_version`,`addendum_version`,`signed_by`,`signed_at`,
     `delivered_by`,`delivered_at`)
  SELECT NEW.organization_id,NEW.id,a.id,a.booking_id,b.patient_id,b.service,
         p.number,a.base_protocol_version,a.version,a.signed_by,a.signed_at,
         NEW.posted_by,NEW.posted_at
  FROM `protocol_addenda` a
  JOIN `protocols` p
    ON p.organization_id=a.organization_id AND p.booking_id=a.booking_id
   AND p.version=a.base_protocol_version AND p.status='issued'
  JOIN `bookings` b ON b.id=a.booking_id AND b.organization_id=a.organization_id
  WHERE a.organization_id=NEW.organization_id AND a.status='issued'
    AND NEW.number='ВК-'||a.id;
END;
--> statement-breakpoint

CREATE TRIGGER `result_addendum_delivery_details_integrity_insert`
BEFORE INSERT ON `result_addendum_delivery_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `protocol_addenda` a
      ON a.organization_id=d.organization_id AND d.number='ВК-'||a.id
    JOIN `protocols` p
      ON p.organization_id=a.organization_id AND p.booking_id=a.booking_id
     AND p.version=a.base_protocol_version AND p.status='issued'
    JOIN `bookings` b ON b.id=a.booking_id AND b.organization_id=a.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='result_delivery' AND d.state='posted'
      AND d.comment='Видача виправлення до протоколу пацієнту'
      AND d.created_by=NEW.delivered_by AND d.posted_by=NEW.delivered_by
      AND d.occurred_at=NEW.delivered_at AND d.posted_at=NEW.delivered_at
      AND a.id=NEW.addendum_id AND a.booking_id=NEW.booking_id AND a.status='issued'
      AND a.signed_by<>'' AND a.signed_at<>'' AND a.signed_version=a.version
      AND b.patient_id=NEW.patient_id AND b.service=NEW.service_title
      AND p.number=NEW.base_protocol_number
      AND a.base_protocol_version=NEW.base_protocol_version
      AND a.version=NEW.addendum_version
      AND a.signed_by=NEW.signed_by AND a.signed_at=NEW.signed_at
      AND (
        (d.basis_document_id IS NULL AND NOT EXISTS (
          SELECT 1 FROM `result_delivery_details` rd
          WHERE rd.organization_id=a.organization_id AND rd.booking_id=a.booking_id
        ))
        OR d.basis_document_id=(
          SELECT rd.document_id FROM `result_delivery_details` rd
          WHERE rd.organization_id=a.organization_id AND rd.booking_id=a.booking_id
          LIMIT 1
        )
      )
  ) THEN RAISE(ABORT,'result_addendum_delivery_snapshot_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `result_addendum_delivery_details_no_update`
BEFORE UPDATE ON `result_addendum_delivery_details`
BEGIN SELECT RAISE(ABORT,'result_addendum_delivery_snapshot_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `result_addendum_delivery_details_no_delete`
BEFORE DELETE ON `result_addendum_delivery_details`
BEGIN SELECT RAISE(ABORT,'result_addendum_delivery_snapshot_immutable'); END;
--> statement-breakpoint

-- Atomic bridge: addendum issuance and delivery evidence are one transaction.
CREATE TRIGGER `result_addendum_delivery_from_issue`
AFTER UPDATE OF `status` ON `protocol_addenda`
WHEN OLD.status='signed' AND NEW.status='issued'
BEGIN
  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,
     `created_by`,`posted_by`,`posted_at`,`basis_document_id`)
  VALUES (
    NEW.organization_id,'result_delivery','ВК-'||NEW.id,CURRENT_TIMESTAMP,'posted',
    'Видача виправлення до протоколу пацієнту',NEW.updated_by,NEW.updated_by,CURRENT_TIMESTAMP,
    (SELECT rd.document_id FROM `result_delivery_details` rd
     WHERE rd.organization_id=NEW.organization_id AND rd.booking_id=NEW.booking_id LIMIT 1)
  );
END;
--> statement-breakpoint
