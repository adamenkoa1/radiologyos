CREATE TABLE `inventory_count_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	`line_no` integer NOT NULL,
	`item_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`warehouse_code` text DEFAULT '' NOT NULL,
	`warehouse_name` text DEFAULT '' NOT NULL,
	`item_name` text DEFAULT '' NOT NULL,
	`item_unit` text DEFAULT '' NOT NULL,
	`lot_number` text DEFAULT '' NOT NULL,
	`book_quantity` real NOT NULL,
	`counted_quantity` real NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_count_lines_book_nonnegative" CHECK(book_quantity >= 0),
	CONSTRAINT "inventory_count_lines_counted_nonnegative" CHECK(counted_quantity >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_count_lines_doc_line_idx` ON `inventory_count_lines` (`organization_id`,`document_id`,`line_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_count_lines_bucket_unique` ON `inventory_count_lines` (`organization_id`,`document_id`,`warehouse_id`,`lot_id`);--> statement-breakpoint
CREATE INDEX `inventory_count_lines_warehouse_idx` ON `inventory_count_lines` (`organization_id`,`warehouse_id`,`item_id`,`document_id`);
--> statement-breakpoint

-- Count rows are immutable evidence of what the system showed when the physical count was recorded.
CREATE TRIGGER `inventory_count_line_integrity_insert`
BEFORE INSERT ON `inventory_count_lines`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='inventory_count' AND d.state='draft'
  ) THEN RAISE(ABORT,'inventory_count_document_invalid') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `inventory_lots` l
    JOIN `inventory_items` i ON i.id=l.item_id AND i.organization_id=l.organization_id
    WHERE l.id=NEW.lot_id AND l.organization_id=NEW.organization_id
      AND i.id=NEW.item_id AND i.active=1
      AND i.name=NEW.item_name AND i.unit=NEW.item_unit
      AND l.lot_number=NEW.lot_number
  ) THEN RAISE(ABORT,'inventory_count_lot_mismatch') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `warehouses` w
    WHERE w.id=NEW.warehouse_id AND w.organization_id=NEW.organization_id AND w.active=1
      AND w.code=NEW.warehouse_code AND w.name=NEW.warehouse_name
  ) THEN RAISE(ABORT,'inventory_count_warehouse_mismatch') END;

  SELECT CASE WHEN ABS(NEW.book_quantity-COALESCE((
    SELECT SUM(m.quantity_delta) FROM `inventory_movements` m
    WHERE m.organization_id=NEW.organization_id
      AND m.warehouse_id=NEW.warehouse_id
      AND m.lot_id=NEW.lot_id
  ),0))>0.000001 THEN RAISE(ABORT,'inventory_count_book_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `inventory_count_line_no_update`
BEFORE UPDATE ON `inventory_count_lines`
BEGIN SELECT RAISE(ABORT,'inventory_count_line_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `inventory_count_line_delete_only_draft`
BEFORE DELETE ON `inventory_count_lines`
WHEN NOT EXISTS (
  SELECT 1 FROM `business_documents` d
  WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id
    AND d.document_type='inventory_count' AND d.state='draft'
)
BEGIN SELECT RAISE(ABORT,'inventory_count_line_immutable'); END;
--> statement-breakpoint

-- Posting fails closed when any ledger fact changed after the count snapshot was captured.
CREATE TRIGGER `inventory_count_posting_snapshot_fresh`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='inventory_count' AND OLD.state='draft' AND NEW.state='posted'
BEGIN
  SELECT CASE WHEN trim(NEW.posted_by)=''
    THEN RAISE(ABORT,'inventory_count_posted_by_required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `inventory_count_lines` l
    WHERE l.organization_id=OLD.organization_id AND l.document_id=OLD.id
  ) THEN RAISE(ABORT,'inventory_count_lines_required') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `inventory_count_lines` l
    WHERE l.organization_id=OLD.organization_id AND l.document_id=OLD.id
      AND ABS(l.book_quantity-COALESCE((
        SELECT SUM(m.quantity_delta) FROM `inventory_movements` m
        WHERE m.organization_id=l.organization_id
          AND m.warehouse_id=l.warehouse_id
          AND m.lot_id=l.lot_id
      ),0))>0.000001
  ) THEN RAISE(ABORT,'inventory_count_stale_balance') END;
END;
--> statement-breakpoint

CREATE TRIGGER `inventory_count_movement_requires_registrar`
BEFORE INSERT ON `inventory_movements`
WHEN NEW.movement_type='count_adjustment'
  AND (NEW.document_id IS NULL OR NEW.document_line_id IS NULL)
BEGIN SELECT RAISE(ABORT,'inventory_count_registrar_required'); END;
--> statement-breakpoint

-- Extend the exact registrar contract with inventory_count -> count_adjustment.
DROP TRIGGER IF EXISTS `inventory_movement_document_integrity`;
--> statement-breakpoint
CREATE TRIGGER `inventory_movement_document_integrity`
BEFORE INSERT ON `inventory_movements`
WHEN NEW.document_id IS NOT NULL OR NEW.document_line_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.document_id IS NULL OR NEW.document_line_id IS NULL
    THEN RAISE(ABORT,'inventory_document_link_incomplete') END;

  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1
      FROM `business_documents` d
      JOIN `inventory_document_lines` l
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
    )
    OR
    EXISTS (
      SELECT 1
      FROM `business_documents` d
      JOIN `inventory_count_lines` l
        ON l.document_id=d.id AND l.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
        AND d.document_type='inventory_count' AND d.state='posted'
        AND l.id=NEW.document_line_id
        AND l.item_id=NEW.item_id AND l.lot_id=NEW.lot_id
        AND l.warehouse_id=NEW.warehouse_id
        AND l.warehouse_code=NEW.warehouse_code AND l.warehouse_name=NEW.warehouse_name
        AND l.reason=NEW.reason
        AND NEW.booking_id IS NULL
        AND NEW.movement_type='count_adjustment'
        AND ABS(NEW.quantity_delta-(l.counted_quantity-l.book_quantity))<0.000001
        AND ABS(NEW.quantity_delta)>0.000001
        AND NEW.actor_email=d.posted_by
    )
  ) THEN RAISE(ABORT,'inventory_document_link_invalid') END;
END;
--> statement-breakpoint

-- Negative count corrections are physical removals and obey the same stock floor as writeoffs/transfers.
DROP TRIGGER IF EXISTS `inventory_writeoff_nonnegative_stock`;
--> statement-breakpoint
CREATE TRIGGER `inventory_writeoff_nonnegative_stock`
BEFORE INSERT ON `inventory_movements`
WHEN NEW.movement_type IN ('writeoff','transfer_out')
  OR (NEW.movement_type='count_adjustment' AND NEW.quantity_delta<0)
BEGIN
  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(quantity_delta) FROM `inventory_movements`
      WHERE organization_id=NEW.organization_id AND lot_id=NEW.lot_id
        AND warehouse_id IS NEW.warehouse_id
    ),0)+NEW.quantity_delta
  ) < -0.000001 THEN RAISE(ABORT,'inventory_negative_stock') END;
END;
--> statement-breakpoint

-- D1 owns the adjustment facts. Posting atomically appends one movement per non-zero discrepancy.
CREATE TRIGGER `inventory_count_auto_post_movements`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='inventory_count' AND OLD.state='draft' AND NEW.state='posted'
BEGIN
  INSERT INTO `inventory_movements` (
    organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
    movement_type,quantity_delta,reason,booking_id,actor_email,document_id,document_line_id
  )
  SELECT
    l.organization_id,l.item_id,l.lot_id,l.warehouse_id,l.warehouse_code,l.warehouse_name,
    'count_adjustment',l.counted_quantity-l.book_quantity,l.reason,NULL,NEW.posted_by,NEW.id,l.id
  FROM `inventory_count_lines` l
  WHERE l.organization_id=NEW.organization_id AND l.document_id=NEW.id
    AND ABS(l.counted_quantity-l.book_quantity)>0.000001
  ORDER BY l.line_no,l.id;
END;
--> statement-breakpoint

-- A warehouse referenced by a count cannot disappear from historical evidence.
DROP TRIGGER IF EXISTS `warehouse_referenced_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `warehouse_referenced_no_delete`
BEFORE DELETE ON `warehouses`
WHEN EXISTS (
  SELECT 1 FROM `inventory_document_lines` l
  WHERE l.organization_id=OLD.organization_id
    AND (l.warehouse_id=OLD.id OR l.destination_warehouse_id=OLD.id)
) OR EXISTS (
  SELECT 1 FROM `inventory_count_lines` c
  WHERE c.organization_id=OLD.organization_id AND c.warehouse_id=OLD.id
) OR EXISTS (
  SELECT 1 FROM `inventory_movements` m
  WHERE m.organization_id=OLD.organization_id AND m.warehouse_id=OLD.id
)
BEGIN SELECT RAISE(ABORT,'warehouse_in_use'); END;
--> statement-breakpoint

-- Keep the printed-form registrar guard complete even before the count UI/print action lands.
DROP TRIGGER IF EXISTS `printed_inventory_snapshot_integrity`;
--> statement-breakpoint
CREATE TRIGGER `printed_inventory_snapshot_integrity`
BEFORE INSERT ON `printed_form_snapshots`
WHEN NEW.form_type IN ('inventory_receipt','inventory_writeoff','inventory_transfer','inventory_count')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    WHERE d.id=NEW.document_id
      AND d.organization_id=NEW.organization_id
      AND d.document_type=NEW.form_type
      AND d.state=NEW.document_state
  ) THEN RAISE(ABORT,'printed_form_document_mismatch') END;
END;
