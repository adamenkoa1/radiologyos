-- Scheduling-to-execution lineage for the post-0095 business core.
-- New service deliveries attach to the exact current Appointment. Pre-0095 bookings without
-- Appointment history keep the Patient Order fallback; truly legacy bookings remain basis-less.
-- Existing documents are not rewritten.

-- Generic basis validation must admit Appointment as a possible service-delivery parent.
-- Exact booking/snapshot ownership is enforced below by the typed detail trigger.
DROP TRIGGER IF EXISTS `business_document_basis_integrity_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `business_document_basis_integrity_update`;
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
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type='patient_order'
  ) THEN RAISE(ABORT,'payment_basis_must_be_patient_order') END;
  SELECT CASE WHEN NEW.document_type='refund' AND NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type='payment'
  ) THEN RAISE(ABORT,'refund_basis_must_be_payment') END;
  SELECT CASE WHEN NEW.document_type='service_delivery' AND NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type IN ('patient_order','appointment','service_delivery')
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
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type='patient_order'
  ) THEN RAISE(ABORT,'payment_basis_must_be_patient_order') END;
  SELECT CASE WHEN NEW.document_type='refund' AND NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type='payment'
  ) THEN RAISE(ABORT,'refund_basis_must_be_payment') END;
  SELECT CASE WHEN NEW.document_type='service_delivery' AND NOT EXISTS (
    SELECT 1 FROM `business_documents` src
    WHERE src.id=NEW.basis_document_id AND src.organization_id=NEW.organization_id
      AND src.document_type IN ('patient_order','appointment','service_delivery')
  ) THEN RAISE(ABORT,'service_delivery_basis_invalid') END;
END;
--> statement-breakpoint

-- The typed registrar owns the positive execution basis. A caller-provided basis is accepted only
-- when it is exactly the canonical parent selected by the same rules.
DROP TRIGGER IF EXISTS `service_delivery_assign_order_basis`;
--> statement-breakpoint
CREATE TRIGGER `service_delivery_assign_execution_basis`
BEFORE INSERT ON `service_delivery_details`
BEGIN
  UPDATE `business_documents`
  SET basis_document_id=(
    CASE
      WHEN EXISTS (
        SELECT 1 FROM `appointment_details` history
        WHERE history.organization_id=NEW.organization_id AND history.booking_id=NEW.booking_id
      ) THEN (
        SELECT a.document_id
        FROM `appointment_details` a
        JOIN `business_documents` ad
          ON ad.id=a.document_id AND ad.organization_id=a.organization_id
        WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.booking_id
          AND ad.document_type='appointment' AND ad.state='posted'
        ORDER BY a.appointment_version DESC
        LIMIT 1
      )
      ELSE (
        SELECT o.document_id FROM `patient_order_details` o
        WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
        LIMIT 1
      )
    END
  )
  WHERE id=NEW.document_id AND organization_id=NEW.organization_id
    AND document_type='service_delivery' AND state='draft'
    AND reversed_document_id IS NULL AND basis_document_id IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM `appointment_details` a
        WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.booking_id
      )
      OR EXISTS (
        SELECT 1 FROM `patient_order_details` o
        WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
      )
    );

  -- Once Appointment history exists, only the latest posted Appointment of this exact booking is valid.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `appointment_details` history
    WHERE history.organization_id=NEW.organization_id AND history.booking_id=NEW.booking_id
  ) AND NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `appointment_details` a
      ON a.document_id=d.basis_document_id AND a.organization_id=d.organization_id
    JOIN `business_documents` ad
      ON ad.id=a.document_id AND ad.organization_id=a.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.reversed_document_id IS NULL
      AND a.booking_id=NEW.booking_id
      AND ad.document_type='appointment' AND ad.state='posted'
      AND a.appointment_version=(
        SELECT MAX(x.appointment_version) FROM `appointment_details` x
        WHERE x.organization_id=NEW.organization_id AND x.booking_id=NEW.booking_id
      )
      AND a.patient_id=NEW.patient_id
      AND a.service_code=NEW.service_code
      AND a.service_title=NEW.service_title
      AND a.equipment_id=NEW.equipment_id
      AND a.duration_minutes=NEW.duration_minutes
  ) THEN RAISE(ABORT,'service_delivery_appointment_basis_mismatch') END;

  -- Pre-0095 bookings that have a Patient Order but no Appointment retain the old root edge.
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `appointment_details` a
    WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.booking_id
  ) AND EXISTS (
    SELECT 1 FROM `patient_order_details` o
    WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
  ) AND NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `patient_order_details` o
      ON o.document_id=d.basis_document_id AND o.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.reversed_document_id IS NULL
      AND o.booking_id=NEW.booking_id
  ) THEN RAISE(ABORT,'service_delivery_patient_order_basis_mismatch') END;

  -- Truly legacy bookings without either business root stay basis-less.
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `appointment_details` a
    WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.booking_id
  ) AND NOT EXISTS (
    SELECT 1 FROM `patient_order_details` o
    WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
  ) AND EXISTS (
    SELECT 1 FROM `business_documents` d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.reversed_document_id IS NULL
      AND d.basis_document_id IS NOT NULL
  ) THEN RAISE(ABORT,'legacy_service_delivery_basis_forbidden') END;
END;
--> statement-breakpoint

-- Once execution has a typed service-delivery registrar, its scheduling parent cannot be replaced
-- by a retrospective date/time edit. Cancellation remains a separate status-only transition.
CREATE TRIGGER `booking_service_delivery_schedule_immutable`
BEFORE UPDATE OF `desired_date`,`desired_time` ON `bookings`
WHEN (NEW.desired_date IS NOT OLD.desired_date OR NEW.desired_time IS NOT OLD.desired_time)
  AND EXISTS (
    SELECT 1
    FROM `service_delivery_details` s
    JOIN `business_documents` d ON d.id=s.document_id AND d.organization_id=s.organization_id
    WHERE s.organization_id=OLD.organization_id AND s.booking_id=OLD.id
      AND d.document_type='service_delivery' AND d.state IN ('draft','posted','reversed')
  )
BEGIN
  SELECT RAISE(ABORT,'service_delivery_schedule_immutable');
END;
--> statement-breakpoint
