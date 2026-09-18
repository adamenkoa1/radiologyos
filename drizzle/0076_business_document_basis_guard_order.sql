-- Keep basis validation deterministic inside one trigger. SQLite does not guarantee
-- an application-level contract for the relative execution order of separate BEFORE triggers.
-- A missing/cross-tenant basis must therefore be rejected before document-type validation.

DROP TRIGGER IF EXISTS `business_document_basis_tenant_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `business_document_basis_type_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `business_document_basis_tenant_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `business_document_basis_type_update`;
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
