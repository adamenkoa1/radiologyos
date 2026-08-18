-- Materialize patient result delivery as a first-class business document.
-- Existing issued protocols are deliberately not backfilled: only future signed -> issued
-- transitions create a result_delivery registrar. The delivery document owns no accounting
-- or operational movements; it is immutable documentary evidence of administrative delivery.

CREATE TABLE `result_delivery_details` (
	`organization_id` integer NOT NULL,
	`document_id` integer PRIMARY KEY NOT NULL,
	`booking_id` integer NOT NULL,
	`patient_id` text DEFAULT '' NOT NULL,
	`service_title` text NOT NULL,
	`protocol_number` text NOT NULL,
	`protocol_version` integer NOT NULL,
	`signed_by` text NOT NULL,
	`signed_at` text NOT NULL,
	`delivered_by` text NOT NULL,
	`delivered_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "result_delivery_details_check_1" CHECK(`protocol_version` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_delivery_booking_unique` ON `result_delivery_details` (`organization_id`,`booking_id`);
--> statement-breakpoint
CREATE INDEX `result_delivery_document_idx` ON `result_delivery_details` (`organization_id`,`document_id`);
--> statement-breakpoint

-- A result-delivery document is born already posted because delivery is the fact itself.
-- Its deterministic number identifies the booking and lets D1 validate a direct/manual insert
-- without trusting application-supplied patient or protocol fields.
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

-- The business document is the registrar; details are populated exclusively from canonical
-- booking/protocol state and the document actor/timestamp. No PHI is accepted from the API.
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

CREATE TRIGGER `result_delivery_details_integrity_insert`
BEFORE INSERT ON `result_delivery_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `protocols` p
      ON p.organization_id=d.organization_id
     AND d.number=printf('ВР-%06d',p.booking_id)
    JOIN `bookings` b
      ON b.id=p.booking_id AND b.organization_id=p.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='result_delivery' AND d.state='posted'
      AND d.created_by=NEW.delivered_by AND d.posted_by=NEW.delivered_by
      AND d.occurred_at=NEW.delivered_at AND d.posted_at=NEW.delivered_at
      AND p.booking_id=NEW.booking_id AND p.status='issued'
      AND b.patient_id=NEW.patient_id AND b.service=NEW.service_title
      AND p.number=NEW.protocol_number AND p.version=NEW.protocol_version
      AND p.signed_by=NEW.signed_by AND p.signed_at=NEW.signed_at
      AND p.signed_by<>'' AND p.signed_at<>'' AND p.signed_version=p.version
      AND (
        (
          d.basis_document_id IS NULL
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
              AND s.booking_id=NEW.booking_id
          )
        )
        OR d.basis_document_id=(
          SELECT perf.id
          FROM `business_documents` perf
          JOIN `business_documents` src
            ON src.id=perf.basis_document_id AND src.organization_id=perf.organization_id
          JOIN `service_delivery_details` s
            ON s.document_id=src.id AND s.organization_id=src.organization_id
          WHERE perf.organization_id=NEW.organization_id
            AND perf.document_type='study_performance' AND perf.state='posted'
            AND src.document_type='service_delivery'
            AND s.booking_id=NEW.booking_id
          ORDER BY perf.id DESC
          LIMIT 1
        )
      )
  ) THEN RAISE(ABORT,'result_delivery_snapshot_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `result_delivery_details_no_update`
BEFORE UPDATE ON `result_delivery_details`
BEGIN
  SELECT RAISE(ABORT,'result_delivery_snapshot_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `result_delivery_details_no_delete`
BEFORE DELETE ON `result_delivery_details`
BEGIN
  SELECT RAISE(ABORT,'result_delivery_snapshot_immutable');
END;
--> statement-breakpoint

-- Delivery is historical evidence and cannot be reversed by reusing the generic posted -> reversed
-- transition. A future correction/reissue, if required, must be a separate explicit document model.
CREATE TRIGGER `result_delivery_document_no_state_change`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='result_delivery' AND NEW.state<>OLD.state
BEGIN
  SELECT RAISE(ABORT,'result_delivery_document_immutable');
END;
--> statement-breakpoint

-- Future issued rows must pass through the signed state. Existing issued protocols are unaffected
-- because creating these triggers does not rewrite historical rows.
CREATE TRIGGER `result_delivery_no_direct_issued_insert`
BEFORE INSERT ON `protocols`
WHEN NEW.status='issued'
BEGIN
  SELECT RAISE(ABORT,'protocol_issue_requires_signed_transition');
END;
--> statement-breakpoint
CREATE TRIGGER `result_delivery_issue_transition_guard`
BEFORE UPDATE OF `status` ON `protocols`
WHEN NEW.status='issued' AND OLD.status<>'issued' AND OLD.status<>'signed'
BEGIN
  SELECT RAISE(ABORT,'protocol_issue_requires_signed_transition');
END;
--> statement-breakpoint

-- Atomic bridge from the medical lifecycle to the business document journal. Since this is an
-- AFTER trigger of the same UPDATE statement, any failure while creating/validating the registrar
-- aborts and rolls back protocol issuance as well.
CREATE TRIGGER `result_delivery_from_protocol_issue`
AFTER UPDATE OF `status` ON `protocols`
WHEN OLD.status='signed' AND NEW.status='issued'
BEGIN
  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,
     `created_by`,`posted_by`,`posted_at`,`basis_document_id`)
  VALUES (
    NEW.organization_id,
    'result_delivery',
    printf('ВР-%06d',NEW.booking_id),
    CURRENT_TIMESTAMP,
    'posted',
    'Видача результату пацієнту',
    NEW.updated_by,
    NEW.updated_by,
    CURRENT_TIMESTAMP,
    (
      SELECT perf.id
      FROM `business_documents` perf
      JOIN `business_documents` src
        ON src.id=perf.basis_document_id AND src.organization_id=perf.organization_id
      JOIN `service_delivery_details` s
        ON s.document_id=src.id AND s.organization_id=src.organization_id
      WHERE perf.organization_id=NEW.organization_id
        AND perf.document_type='study_performance' AND perf.state='posted'
        AND src.document_type='service_delivery'
        AND s.booking_id=NEW.booking_id
      ORDER BY perf.id DESC
      LIMIT 1
    )
  );
END;
