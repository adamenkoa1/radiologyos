-- Harden the first BAS-style register against concurrency and registrar mismatches.

-- Tenant/type/creator identity of a document cannot be rewritten, even while it is a draft.
-- The system may assign its generated number exactly once after INSERT.
CREATE TRIGGER IF NOT EXISTS `business_documents_identity_immutable`
BEFORE UPDATE ON `business_documents`
WHEN NEW.organization_id <> OLD.organization_id
  OR NEW.document_type <> OLD.document_type
  OR NEW.created_by <> OLD.created_by
  OR NEW.created_at <> OLD.created_at
  OR (OLD.number <> '' AND NEW.number <> OLD.number)
BEGIN
  SELECT RAISE(ABORT,'business_document_identity_immutable');
END;
--> statement-breakpoint

-- Draft line edits must preserve tenant ownership just like inserts.
CREATE TRIGGER IF NOT EXISTS `inventory_document_lines_tenant_update`
BEFORE UPDATE ON `inventory_document_lines`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    WHERE d.id = NEW.document_id AND d.organization_id = NEW.organization_id
      AND d.document_type IN ('inventory_receipt','inventory_writeoff','inventory_transfer','inventory_count')
  ) THEN RAISE(ABORT,'inventory_document_tenant_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `inventory_items` i WHERE i.id = NEW.item_id AND i.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT,'inventory_item_tenant_mismatch') END;
  SELECT CASE WHEN NEW.lot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `inventory_lots` l
    WHERE l.id = NEW.lot_id AND l.organization_id = NEW.organization_id AND l.item_id = NEW.item_id
  ) THEN RAISE(ABORT,'inventory_lot_tenant_mismatch') END;
  SELECT CASE WHEN NEW.booking_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `bookings` b WHERE b.id = NEW.booking_id AND b.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT,'inventory_booking_tenant_mismatch') END;
END;
--> statement-breakpoint

-- A register movement is append-only evidence. Corrections are new movements/documents, never edits.
CREATE TRIGGER IF NOT EXISTS `inventory_movements_no_update`
BEFORE UPDATE ON `inventory_movements`
BEGIN SELECT RAISE(ABORT,'inventory_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `inventory_movements_no_delete`
BEFORE DELETE ON `inventory_movements`
BEGIN SELECT RAISE(ABORT,'inventory_movement_immutable'); END;
--> statement-breakpoint

-- Atomic non-negative stock invariant. This closes the race where two concurrent writeoff
-- documents both pass an application-level balance check before either movement is committed.
CREATE TRIGGER IF NOT EXISTS `inventory_writeoff_nonnegative_stock`
BEFORE INSERT ON `inventory_movements`
WHEN NEW.movement_type = 'writeoff'
BEGIN
  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(quantity_delta) FROM `inventory_movements`
      WHERE organization_id = NEW.organization_id AND lot_id = NEW.lot_id
    ),0) + NEW.quantity_delta
  ) < -0.000001 THEN RAISE(ABORT,'inventory_negative_stock') END;
END;
--> statement-breakpoint

-- Replace the initial link check with an exact registrar contract: document type, movement type,
-- sign/quantity, item, lot, booking and reason must all match the posted document line.
DROP TRIGGER IF EXISTS `inventory_movement_document_integrity`;
--> statement-breakpoint
CREATE TRIGGER `inventory_movement_document_integrity`
BEFORE INSERT ON `inventory_movements`
WHEN NEW.document_id IS NOT NULL OR NEW.document_line_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.document_id IS NULL OR NEW.document_line_id IS NULL
    THEN RAISE(ABORT,'inventory_document_link_incomplete') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `inventory_document_lines` l
      ON l.document_id = d.id AND l.organization_id = d.organization_id
    WHERE d.id = NEW.document_id
      AND d.organization_id = NEW.organization_id
      AND d.state = 'posted'
      AND l.id = NEW.document_line_id
      AND l.item_id = NEW.item_id
      AND l.lot_id = NEW.lot_id
      AND COALESCE(l.booking_id,0) = COALESCE(NEW.booking_id,0)
      AND l.reason = NEW.reason
      AND (
        (d.document_type = 'inventory_receipt'
          AND NEW.movement_type = 'receipt'
          AND ABS(NEW.quantity_delta - l.quantity) < 0.000001)
        OR
        (d.document_type = 'inventory_writeoff'
          AND NEW.movement_type = 'writeoff'
          AND ABS(NEW.quantity_delta + l.quantity) < 0.000001)
      )
  ) THEN RAISE(ABORT,'inventory_document_link_invalid') END;
END;
--> statement-breakpoint

-- Current warehouse printed forms must be snapshots of the exact same tenant/type/state document.
CREATE TRIGGER IF NOT EXISTS `printed_inventory_snapshot_integrity`
BEFORE INSERT ON `printed_form_snapshots`
WHEN NEW.form_type IN ('inventory_receipt','inventory_writeoff')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    WHERE d.id = NEW.document_id
      AND d.organization_id = NEW.organization_id
      AND d.document_type = NEW.form_type
      AND d.state = NEW.document_state
  ) THEN RAISE(ABORT,'printed_form_document_mismatch') END;
END;