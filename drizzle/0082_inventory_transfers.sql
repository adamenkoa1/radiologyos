-- BAS-style warehouse transfer: one posted document line produces two immutable register facts.
-- warehouse_* is the frozen source snapshot; destination_warehouse_* is the frozen destination snapshot.
ALTER TABLE `inventory_document_lines` ADD COLUMN `destination_warehouse_id` integer;
--> statement-breakpoint
ALTER TABLE `inventory_document_lines` ADD COLUMN `destination_warehouse_code` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `inventory_document_lines` ADD COLUMN `destination_warehouse_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `inventory_lines_destination_warehouse_idx`
  ON `inventory_document_lines` (`organization_id`,`destination_warehouse_id`,`document_id`,`line_no`)
  WHERE `destination_warehouse_id` IS NOT NULL;
--> statement-breakpoint

-- A transfer line must have a second active warehouse in the same tenant, distinct from the source.
CREATE TRIGGER `inventory_transfer_destination_insert`
BEFORE INSERT ON `inventory_document_lines`
WHEN EXISTS (
  SELECT 1 FROM business_documents d
  WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_transfer'
)
BEGIN
  SELECT CASE WHEN NEW.destination_warehouse_id IS NULL
    THEN RAISE(ABORT,'inventory_transfer_destination_required') END;
  SELECT CASE WHEN NEW.destination_warehouse_id=NEW.warehouse_id
    THEN RAISE(ABORT,'inventory_transfer_same_warehouse') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.id=NEW.destination_warehouse_id AND w.organization_id=NEW.organization_id AND w.active=1
      AND w.code=NEW.destination_warehouse_code AND w.name=NEW.destination_warehouse_name
  ) THEN RAISE(ABORT,'inventory_transfer_destination_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_transfer_destination_update`
BEFORE UPDATE OF `organization_id`,`document_id`,`warehouse_id`,`destination_warehouse_id`,`destination_warehouse_code`,`destination_warehouse_name`
ON `inventory_document_lines`
WHEN EXISTS (
  SELECT 1 FROM business_documents d
  WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_transfer'
)
BEGIN
  SELECT CASE WHEN NEW.destination_warehouse_id IS NULL
    THEN RAISE(ABORT,'inventory_transfer_destination_required') END;
  SELECT CASE WHEN NEW.destination_warehouse_id=NEW.warehouse_id
    THEN RAISE(ABORT,'inventory_transfer_same_warehouse') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.id=NEW.destination_warehouse_id AND w.organization_id=NEW.organization_id AND w.active=1
      AND w.code=NEW.destination_warehouse_code AND w.name=NEW.destination_warehouse_name
  ) THEN RAISE(ABORT,'inventory_transfer_destination_invalid') END;
END;
--> statement-breakpoint

-- Non-transfer documents may not smuggle a destination dimension into the register contract.
CREATE TRIGGER `inventory_nontransfer_destination_insert`
BEFORE INSERT ON `inventory_document_lines`
WHEN NOT EXISTS (
  SELECT 1 FROM business_documents d
  WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='inventory_transfer'
)
  AND (NEW.destination_warehouse_id IS NOT NULL OR NEW.destination_warehouse_code<>'' OR NEW.destination_warehouse_name<>'')
BEGIN SELECT RAISE(ABORT,'inventory_destination_not_allowed'); END;
--> statement-breakpoint

-- Receipt/writeoff have one movement per document line; transfer intentionally has transfer_out + transfer_in.
DROP INDEX IF EXISTS `inventory_movements_document_line_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_movements_document_line_type_idx`
  ON `inventory_movements` (`organization_id`,`document_line_id`,`movement_type`)
  WHERE `document_line_id` IS NOT NULL;
--> statement-breakpoint

-- The source bucket may never go negative for either an ordinary write-off or a transfer-out.
DROP TRIGGER IF EXISTS `inventory_writeoff_nonnegative_stock`;
--> statement-breakpoint
CREATE TRIGGER `inventory_writeoff_nonnegative_stock`
BEFORE INSERT ON `inventory_movements`
WHEN NEW.movement_type IN ('writeoff','transfer_out')
BEGIN
  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(quantity_delta) FROM inventory_movements
      WHERE organization_id=NEW.organization_id AND lot_id=NEW.lot_id
        AND warehouse_id IS NEW.warehouse_id
    ),0)+NEW.quantity_delta
  ) < -0.000001 THEN RAISE(ABORT,'inventory_negative_stock') END;
END;
--> statement-breakpoint

-- Exact registrar contract, now including the paired source/destination movements of a transfer.
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
    FROM business_documents d
    JOIN inventory_document_lines l
      ON l.document_id=d.id AND l.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
      AND l.id=NEW.document_line_id AND l.item_id=NEW.item_id AND l.lot_id=NEW.lot_id
      AND COALESCE(l.booking_id,0)=COALESCE(NEW.booking_id,0) AND l.reason=NEW.reason
      AND (
        (d.document_type='inventory_receipt' AND NEW.movement_type='receipt'
          AND l.warehouse_id=NEW.warehouse_id
          AND l.warehouse_code=NEW.warehouse_code AND l.warehouse_name=NEW.warehouse_name
          AND ABS(NEW.quantity_delta-l.quantity)<0.000001)
        OR
        (d.document_type='inventory_writeoff' AND NEW.movement_type='writeoff'
          AND l.warehouse_id=NEW.warehouse_id
          AND l.warehouse_code=NEW.warehouse_code AND l.warehouse_name=NEW.warehouse_name
          AND ABS(NEW.quantity_delta+l.quantity)<0.000001)
        OR
        (d.document_type='inventory_transfer' AND NEW.movement_type='transfer_out'
          AND l.warehouse_id=NEW.warehouse_id
          AND l.warehouse_code=NEW.warehouse_code AND l.warehouse_name=NEW.warehouse_name
          AND ABS(NEW.quantity_delta+l.quantity)<0.000001)
        OR
        (d.document_type='inventory_transfer' AND NEW.movement_type='transfer_in'
          AND l.destination_warehouse_id=NEW.warehouse_id
          AND l.destination_warehouse_code=NEW.warehouse_code AND l.destination_warehouse_name=NEW.warehouse_name
          AND ABS(NEW.quantity_delta-l.quantity)<0.000001)
      )
  ) THEN RAISE(ABORT,'inventory_document_link_invalid') END;
END;
--> statement-breakpoint

-- Printed transfer forms, when added, must point to the exact posted transfer document.
DROP TRIGGER IF EXISTS `printed_inventory_snapshot_integrity`;
--> statement-breakpoint
CREATE TRIGGER `printed_inventory_snapshot_integrity`
BEFORE INSERT ON `printed_form_snapshots`
WHEN NEW.form_type IN ('inventory_receipt','inventory_writeoff','inventory_transfer')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id
      AND d.organization_id=NEW.organization_id
      AND d.document_type=NEW.form_type
      AND d.state=NEW.document_state
  ) THEN RAISE(ABORT,'printed_form_document_mismatch') END;
END;
