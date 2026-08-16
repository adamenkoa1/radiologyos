-- BAS-style warehouse transfer: one posted document moves the same lot quantity from one
-- warehouse bucket to another without changing organization-wide stock.
CREATE TABLE IF NOT EXISTS `inventory_transfer_details` (
  `organization_id` integer NOT NULL,
  `document_id` integer PRIMARY KEY NOT NULL,
  `source_warehouse_id` integer NOT NULL,
  `source_warehouse_code` text DEFAULT '' NOT NULL,
  `source_warehouse_name` text NOT NULL,
  `destination_warehouse_id` integer NOT NULL,
  `destination_warehouse_code` text DEFAULT '' NOT NULL,
  `destination_warehouse_name` text NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`),
  FOREIGN KEY (`source_warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`destination_warehouse_id`) REFERENCES `warehouses`(`id`),
  CHECK (`source_warehouse_id` <> `destination_warehouse_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `inventory_transfer_details_org_doc_idx`
  ON `inventory_transfer_details` (`organization_id`,`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_transfer_details_source_idx`
  ON `inventory_transfer_details` (`organization_id`,`source_warehouse_id`,`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_transfer_details_destination_idx`
  ON `inventory_transfer_details` (`organization_id`,`destination_warehouse_id`,`document_id`);
--> statement-breakpoint

-- A transfer header is a frozen tenant-scoped snapshot while its registrar is a draft.
CREATE TRIGGER `inventory_transfer_details_integrity_insert`
BEFORE INSERT ON `inventory_transfer_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='inventory_transfer' AND d.state='draft'
  ) THEN RAISE(ABORT,'inventory_transfer_document_invalid') END;
  SELECT CASE WHEN NEW.source_warehouse_id=NEW.destination_warehouse_id
    THEN RAISE(ABORT,'inventory_transfer_same_warehouse') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.id=NEW.source_warehouse_id AND w.organization_id=NEW.organization_id AND w.active=1
      AND w.code=NEW.source_warehouse_code AND w.name=NEW.source_warehouse_name
  ) THEN RAISE(ABORT,'inventory_transfer_source_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.id=NEW.destination_warehouse_id AND w.organization_id=NEW.organization_id AND w.active=1
      AND w.code=NEW.destination_warehouse_code AND w.name=NEW.destination_warehouse_name
  ) THEN RAISE(ABORT,'inventory_transfer_destination_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_transfer_details_integrity_update`
BEFORE UPDATE ON `inventory_transfer_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id
      AND d.document_type='inventory_transfer' AND d.state='draft'
  ) THEN RAISE(ABORT,'inventory_transfer_immutable') END;
  SELECT CASE WHEN NEW.organization_id<>OLD.organization_id OR NEW.document_id<>OLD.document_id
    THEN RAISE(ABORT,'inventory_transfer_identity_immutable') END;
  SELECT CASE WHEN NEW.source_warehouse_id=NEW.destination_warehouse_id
    THEN RAISE(ABORT,'inventory_transfer_same_warehouse') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.id=NEW.source_warehouse_id AND w.organization_id=NEW.organization_id AND w.active=1
      AND w.code=NEW.source_warehouse_code AND w.name=NEW.source_warehouse_name
  ) THEN RAISE(ABORT,'inventory_transfer_source_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.id=NEW.destination_warehouse_id AND w.organization_id=NEW.organization_id AND w.active=1
      AND w.code=NEW.destination_warehouse_code AND w.name=NEW.destination_warehouse_name
  ) THEN RAISE(ABORT,'inventory_transfer_destination_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_transfer_details_no_delete_posted`
BEFORE DELETE ON `inventory_transfer_details`
WHEN NOT EXISTS (
  SELECT 1 FROM business_documents d
  WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft'
)
BEGIN SELECT RAISE(ABORT,'inventory_transfer_immutable'); END;
--> statement-breakpoint

-- A warehouse referenced only by a draft transfer header is still in use. Recreate the guard from
-- 0081 with transfer details included.
DROP TRIGGER IF EXISTS `warehouse_referenced_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `warehouse_referenced_no_delete`
BEFORE DELETE ON `warehouses`
WHEN EXISTS (
  SELECT 1 FROM inventory_document_lines l
  WHERE l.organization_id=OLD.organization_id AND l.warehouse_id=OLD.id
) OR EXISTS (
  SELECT 1 FROM inventory_movements m
  WHERE m.organization_id=OLD.organization_id AND m.warehouse_id=OLD.id
) OR EXISTS (
  SELECT 1 FROM inventory_transfer_details t
  WHERE t.organization_id=OLD.organization_id
    AND (t.source_warehouse_id=OLD.id OR t.destination_warehouse_id=OLD.id)
)
BEGIN SELECT RAISE(ABORT,'warehouse_in_use'); END;
--> statement-breakpoint

-- A transfer line inherits traceability from the selected historical lot exactly like a write-off.
-- Recreate the supplier guards from 0078 so inventory_transfer is a valid historical-lot document.
DROP TRIGGER IF EXISTS `inventory_line_supplier_reference_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `inventory_line_supplier_reference_update`;
--> statement-breakpoint
CREATE TRIGGER `inventory_line_supplier_reference_insert`
BEFORE INSERT ON `inventory_document_lines`
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
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type IN ('inventory_writeoff','inventory_transfer')
  ) AND NOT EXISTS (
    SELECT 1 FROM inventory_lots l
    WHERE l.id=NEW.lot_id AND l.organization_id=NEW.organization_id
      AND l.supplier_counterparty_id=NEW.supplier_counterparty_id AND l.supplier=NEW.supplier
  ) THEN RAISE(ABORT,'inventory_writeoff_supplier_trace_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type IN ('inventory_receipt','inventory_writeoff','inventory_transfer')
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
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type IN ('inventory_writeoff','inventory_transfer')
  ) AND NOT EXISTS (
    SELECT 1 FROM inventory_lots l
    WHERE l.id=NEW.lot_id AND l.organization_id=NEW.organization_id
      AND l.supplier_counterparty_id=NEW.supplier_counterparty_id AND l.supplier=NEW.supplier
  ) THEN RAISE(ABORT,'inventory_writeoff_supplier_trace_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type IN ('inventory_receipt','inventory_writeoff','inventory_transfer')
  ) THEN RAISE(ABORT,'counterparty_supplier_document_type_invalid') END;
END;
--> statement-breakpoint

-- One receipt/writeoff line still has one registrar movement. A transfer line has exactly one
-- transfer_out and one transfer_in; uniqueness is therefore line+movement type.
DROP INDEX IF EXISTS `inventory_movements_document_line_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_movements_document_line_type_idx`
  ON `inventory_movements` (`organization_id`,`document_line_id`,`movement_type`)
  WHERE `document_line_id` IS NOT NULL;
--> statement-breakpoint

-- A negative transfer is subject to the same atomic stock invariant as a write-off, scoped to
-- source warehouse + lot. The paired transfer_in is positive and cannot make stock negative.
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

-- Exact registrar contract for all warehouse documents, including both transfer directions.
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
    LEFT JOIN inventory_transfer_details t
      ON t.document_id=d.id AND t.organization_id=d.organization_id
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
          AND t.source_warehouse_id=l.warehouse_id
          AND t.source_warehouse_code=l.warehouse_code AND t.source_warehouse_name=l.warehouse_name
          AND l.warehouse_id=NEW.warehouse_id
          AND l.warehouse_code=NEW.warehouse_code AND l.warehouse_name=NEW.warehouse_name
          AND ABS(NEW.quantity_delta+l.quantity)<0.000001)
        OR
        (d.document_type='inventory_transfer' AND NEW.movement_type='transfer_in'
          AND t.source_warehouse_id=l.warehouse_id
          AND t.source_warehouse_code=l.warehouse_code AND t.source_warehouse_name=l.warehouse_name
          AND t.destination_warehouse_id=NEW.warehouse_id
          AND t.destination_warehouse_code=NEW.warehouse_code
          AND t.destination_warehouse_name=NEW.warehouse_name
          AND ABS(NEW.quantity_delta-l.quantity)<0.000001)
      )
  ) THEN RAISE(ABORT,'inventory_document_link_invalid') END;
END;
--> statement-breakpoint

-- A transfer cannot transition to posted unless its full header/line snapshot is coherent.
CREATE TRIGGER `inventory_transfer_post_requirements`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='inventory_transfer' AND OLD.state='draft' AND NEW.state='posted'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM inventory_transfer_details t
    WHERE t.document_id=OLD.id AND t.organization_id=OLD.organization_id
      AND t.source_warehouse_id<>t.destination_warehouse_id
  ) THEN RAISE(ABORT,'inventory_transfer_details_required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM inventory_document_lines l
    WHERE l.document_id=OLD.id AND l.organization_id=OLD.organization_id
  ) THEN RAISE(ABORT,'inventory_transfer_lines_required') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM inventory_document_lines l
    JOIN inventory_transfer_details t
      ON t.document_id=l.document_id AND t.organization_id=l.organization_id
    WHERE l.document_id=OLD.id AND l.organization_id=OLD.organization_id
      AND (l.lot_id IS NULL
        OR l.warehouse_id<>t.source_warehouse_id
        OR l.warehouse_code<>t.source_warehouse_code
        OR l.warehouse_name<>t.source_warehouse_name)
  ) THEN RAISE(ABORT,'inventory_transfer_source_snapshot_mismatch') END;
END;
--> statement-breakpoint

-- Posting itself is the registrar engine: direct D1 state changes cannot create a half-transfer.
-- If any source bucket would become negative, inventory_negative_stock aborts the whole UPDATE and
-- therefore both movement directions and the posted state roll back atomically.
CREATE TRIGGER `inventory_transfer_post_movements`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='inventory_transfer' AND OLD.state='draft' AND NEW.state='posted'
BEGIN
  INSERT INTO inventory_movements
    (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
     movement_type,quantity_delta,reason,booking_id,actor_email,document_id,document_line_id,created_at)
  SELECT l.organization_id,l.item_id,l.lot_id,l.warehouse_id,l.warehouse_code,l.warehouse_name,
         'transfer_out',-l.quantity,l.reason,l.booking_id,NEW.posted_by,NEW.id,l.id,NEW.posted_at
  FROM inventory_document_lines l
  WHERE l.organization_id=NEW.organization_id AND l.document_id=NEW.id;

  INSERT INTO inventory_movements
    (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
     movement_type,quantity_delta,reason,booking_id,actor_email,document_id,document_line_id,created_at)
  SELECT l.organization_id,l.item_id,l.lot_id,t.destination_warehouse_id,t.destination_warehouse_code,t.destination_warehouse_name,
         'transfer_in',l.quantity,l.reason,l.booking_id,NEW.posted_by,NEW.id,l.id,NEW.posted_at
  FROM inventory_document_lines l
  JOIN inventory_transfer_details t
    ON t.document_id=l.document_id AND t.organization_id=l.organization_id
  WHERE l.organization_id=NEW.organization_id AND l.document_id=NEW.id;
END;