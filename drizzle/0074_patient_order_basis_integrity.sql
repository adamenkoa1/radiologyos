-- Typed registrars own their canonical basis. API callers do not get to invent the document graph.

-- New payments are based on the Patient Order when one exists. Legacy bookings without an order
-- remain basis-less; the migration intentionally performs no retrospective backfill.
CREATE TRIGGER IF NOT EXISTS `finance_document_assign_basis`
BEFORE INSERT ON `finance_document_details`
BEGIN
  UPDATE business_documents
  SET basis_document_id=(
    CASE
      WHEN document_type='payment' THEN (
        SELECT o.document_id FROM patient_order_details o
        WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id LIMIT 1
      )
      WHEN document_type='refund' THEN NEW.source_document_id
      ELSE basis_document_id
    END
  )
  WHERE id=NEW.document_id AND organization_id=NEW.organization_id
    AND state='draft' AND basis_document_id IS NULL;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='payment'
  ) AND EXISTS (
    SELECT 1 FROM patient_order_details o
    WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
  ) AND NOT EXISTS (
    SELECT 1 FROM business_documents d
    JOIN patient_order_details o ON o.document_id=d.basis_document_id AND o.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='payment' AND o.booking_id=NEW.booking_id
  ) THEN RAISE(ABORT,'payment_patient_order_basis_mismatch') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='payment'
  ) AND NOT EXISTS (
    SELECT 1 FROM patient_order_details o
    WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
  ) AND EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.basis_document_id IS NOT NULL
  ) THEN RAISE(ABORT,'legacy_payment_basis_forbidden') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='refund'
      AND d.basis_document_id IS NOT NEW.source_document_id
  ) THEN RAISE(ABORT,'refund_payment_basis_mismatch') END;
END;
--> statement-breakpoint

-- A service delivery is based on its Patient Order when the booking belongs to the new BAS contour.
CREATE TRIGGER IF NOT EXISTS `service_delivery_assign_order_basis`
BEFORE INSERT ON `service_delivery_details`
BEGIN
  UPDATE business_documents
  SET basis_document_id=(
    SELECT o.document_id FROM patient_order_details o
    WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id LIMIT 1
  )
  WHERE id=NEW.document_id AND organization_id=NEW.organization_id
    AND document_type='service_delivery' AND state='draft'
    AND reversed_document_id IS NULL AND basis_document_id IS NULL
    AND EXISTS (
      SELECT 1 FROM patient_order_details o
      WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
    );

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM patient_order_details o
    WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
  ) AND NOT EXISTS (
    SELECT 1 FROM business_documents d
    JOIN patient_order_details o ON o.document_id=d.basis_document_id AND o.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.reversed_document_id IS NULL
      AND o.booking_id=NEW.booking_id
  ) THEN RAISE(ABORT,'service_delivery_patient_order_basis_mismatch') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM patient_order_details o
    WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
  ) AND EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.reversed_document_id IS NULL
      AND d.basis_document_id IS NOT NULL
  ) THEN RAISE(ABORT,'legacy_service_delivery_basis_forbidden') END;
END;
--> statement-breakpoint

-- Service storno is based on the exact service-delivery document it reverses.
CREATE TRIGGER IF NOT EXISTS `service_correction_assign_basis`
BEFORE INSERT ON `service_correction_details`
BEGIN
  UPDATE business_documents
  SET basis_document_id=NEW.source_document_id
  WHERE id=NEW.document_id AND organization_id=NEW.organization_id
    AND document_type='service_delivery' AND state='draft'
    AND reversed_document_id=NEW.source_document_id AND basis_document_id IS NULL;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery' AND d.state='draft'
      AND d.reversed_document_id=NEW.source_document_id
      AND d.basis_document_id=NEW.source_document_id
  ) THEN RAISE(ABORT,'service_correction_basis_mismatch') END;
END;
--> statement-breakpoint

-- Once a typed detail exists, the draft basis is frozen as part of registrar identity.
CREATE TRIGGER IF NOT EXISTS `typed_document_basis_draft_frozen`
BEFORE UPDATE OF `basis_document_id` ON `business_documents`
WHEN OLD.state='draft' AND OLD.basis_document_id IS NOT NEW.basis_document_id
  AND (
    EXISTS (SELECT 1 FROM patient_order_details o WHERE o.document_id=OLD.id AND o.organization_id=OLD.organization_id)
    OR EXISTS (SELECT 1 FROM finance_document_details f WHERE f.document_id=OLD.id AND f.organization_id=OLD.organization_id)
    OR EXISTS (SELECT 1 FROM service_delivery_details s WHERE s.document_id=OLD.id AND s.organization_id=OLD.organization_id)
    OR EXISTS (SELECT 1 FROM service_correction_details c WHERE c.document_id=OLD.id AND c.organization_id=OLD.organization_id)
  )
BEGIN SELECT RAISE(ABORT,'business_document_basis_frozen'); END;
