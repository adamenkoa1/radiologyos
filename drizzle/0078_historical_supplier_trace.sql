-- A write-off inherits supplier traceability from the historical lot. It must not revalidate
-- that old supplier snapshot against current counterparty master data after rename/deactivation.
DROP TRIGGER IF EXISTS `inventory_line_supplier_reference_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `inventory_line_supplier_reference_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `inventory_lot_supplier_reference_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `inventory_lot_supplier_reference_update`;
--> statement-breakpoint

CREATE TRIGGER `inventory_line_supplier_reference_insert`
BEFORE INSERT ON `inventory_document_lines`
WHEN NEW.supplier_counterparty_id IS NOT NULL
BEGIN
  -- A new receipt selects current active supplier master data and freezes its name snapshot.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_receipt'
  ) AND NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'counterparty_supplier_tenant_mismatch') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_receipt'
  ) AND NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
      AND c.active=1 AND c.kind IN ('supplier','both')
  ) THEN RAISE(ABORT,'counterparty_not_active_supplier') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_receipt'
  ) AND NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id AND c.name=NEW.supplier
  ) THEN RAISE(ABORT,'counterparty_supplier_snapshot_mismatch') END;

  -- A write-off copies the exact supplier identity + snapshot from the selected historical lot.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_writeoff'
  ) AND NOT EXISTS (
    SELECT 1 FROM inventory_lots l
    WHERE l.id=NEW.lot_id AND l.organization_id=NEW.organization_id
      AND l.supplier_counterparty_id=NEW.supplier_counterparty_id AND l.supplier=NEW.supplier
  ) THEN RAISE(ABORT,'inventory_writeoff_supplier_trace_mismatch') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type IN ('inventory_receipt','inventory_writeoff')
  ) THEN RAISE(ABORT,'counterparty_supplier_document_type_invalid') END;
END;
--> statement-breakpoint

CREATE TRIGGER `inventory_line_supplier_reference_update`
BEFORE UPDATE OF `organization_id`,`document_id`,`lot_id`,`supplier_counterparty_id`,`supplier` ON `inventory_document_lines`
WHEN NEW.supplier_counterparty_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_receipt'
  ) AND NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'counterparty_supplier_tenant_mismatch') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_receipt'
  ) AND NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
      AND c.active=1 AND c.kind IN ('supplier','both')
  ) THEN RAISE(ABORT,'counterparty_not_active_supplier') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_receipt'
  ) AND NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id AND c.name=NEW.supplier
  ) THEN RAISE(ABORT,'counterparty_supplier_snapshot_mismatch') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_writeoff'
  ) AND NOT EXISTS (
    SELECT 1 FROM inventory_lots l
    WHERE l.id=NEW.lot_id AND l.organization_id=NEW.organization_id
      AND l.supplier_counterparty_id=NEW.supplier_counterparty_id AND l.supplier=NEW.supplier
  ) THEN RAISE(ABORT,'inventory_writeoff_supplier_trace_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type IN ('inventory_receipt','inventory_writeoff')
  ) THEN RAISE(ABORT,'counterparty_supplier_document_type_invalid') END;
END;
--> statement-breakpoint

-- Lot creation happens after the receipt line already validated the current supplier reference.
-- At posting time only tenant identity remains authoritative; later master-data state is irrelevant.
CREATE TRIGGER `inventory_lot_supplier_reference_insert`
BEFORE INSERT ON `inventory_lots`
WHEN NEW.supplier_counterparty_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'counterparty_lot_supplier_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_lot_supplier_reference_update`
BEFORE UPDATE OF `organization_id`,`supplier_counterparty_id`,`supplier` ON `inventory_lots`
WHEN NEW.supplier_counterparty_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM inventory_movements m
    WHERE m.organization_id=OLD.organization_id AND m.lot_id=OLD.id
  ) THEN RAISE(ABORT,'inventory_lot_supplier_immutable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'counterparty_lot_supplier_invalid') END;
END;
