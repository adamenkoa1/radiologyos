-- BAS reference: warehouses become an explicit stock-register dimension.
-- The pre-0081 model represented exactly one implicit storage location per organization, so
-- historical rows are deterministically mapped to the seeded MAIN warehouse (not guessed).
CREATE TABLE IF NOT EXISTS `warehouses` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `code` text DEFAULT '' NOT NULL,
  `name` text NOT NULL,
  `active` integer DEFAULT 1 NOT NULL CHECK (`active` IN (0,1)),
  `is_default` integer DEFAULT 0 NOT NULL CHECK (`is_default` IN (0,1)),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `warehouses_org_id_idx`
  ON `warehouses` (`organization_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `warehouses_org_code_idx`
  ON `warehouses` (`organization_id`,`code`) WHERE `code` <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `warehouses_one_default_idx`
  ON `warehouses` (`organization_id`) WHERE `is_default`=1;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `warehouses_org_active_name_idx`
  ON `warehouses` (`organization_id`,`active`,`name`,`id`);
--> statement-breakpoint

INSERT OR IGNORE INTO `warehouses` (`organization_id`,`code`,`name`,`active`,`is_default`)
SELECT id,'MAIN','Основний склад',1,1 FROM organizations;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_seed_default_warehouse`
AFTER INSERT ON `organizations`
BEGIN
  INSERT OR IGNORE INTO warehouses (organization_id,code,name,active,is_default)
    VALUES (NEW.id,'MAIN','Основний склад',1,1);
END;
--> statement-breakpoint

ALTER TABLE `inventory_document_lines` ADD COLUMN `warehouse_id` integer;
--> statement-breakpoint
ALTER TABLE `inventory_document_lines` ADD COLUMN `warehouse_code` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `inventory_document_lines` ADD COLUMN `warehouse_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD COLUMN `warehouse_id` integer;
--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD COLUMN `warehouse_code` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD COLUMN `warehouse_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint

-- Before this migration an organization had one and only one representable warehouse. Preserve
-- those facts by assigning every historical stock row to that organization's seeded MAIN warehouse.
UPDATE inventory_document_lines
SET warehouse_id=(SELECT w.id FROM warehouses w WHERE w.organization_id=inventory_document_lines.organization_id AND w.is_default=1 LIMIT 1),
    warehouse_code=(SELECT w.code FROM warehouses w WHERE w.organization_id=inventory_document_lines.organization_id AND w.is_default=1 LIMIT 1),
    warehouse_name=(SELECT w.name FROM warehouses w WHERE w.organization_id=inventory_document_lines.organization_id AND w.is_default=1 LIMIT 1)
WHERE warehouse_id IS NULL;
--> statement-breakpoint
UPDATE inventory_movements
SET warehouse_id=(SELECT w.id FROM warehouses w WHERE w.organization_id=inventory_movements.organization_id AND w.is_default=1 LIMIT 1),
    warehouse_code=(SELECT w.code FROM warehouses w WHERE w.organization_id=inventory_movements.organization_id AND w.is_default=1 LIMIT 1),
    warehouse_name=(SELECT w.name FROM warehouses w WHERE w.organization_id=inventory_movements.organization_id AND w.is_default=1 LIMIT 1)
WHERE warehouse_id IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `inventory_lines_warehouse_idx`
  ON `inventory_document_lines` (`organization_id`,`warehouse_id`,`document_id`,`line_no`)
  WHERE `warehouse_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_movements_warehouse_item_idx`
  ON `inventory_movements` (`organization_id`,`warehouse_id`,`item_id`,`id` DESC)
  WHERE `warehouse_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_movements_warehouse_lot_idx`
  ON `inventory_movements` (`organization_id`,`warehouse_id`,`lot_id`,`id` DESC)
  WHERE `warehouse_id` IS NOT NULL;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `warehouse_default_must_be_active_insert`
BEFORE INSERT ON `warehouses`
WHEN NEW.is_default=1 AND NEW.active<>1
BEGIN SELECT RAISE(ABORT,'warehouse_default_must_be_active'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `warehouse_default_must_be_active_update`
BEFORE UPDATE OF `active`,`is_default` ON `warehouses`
WHEN NEW.is_default=1 AND NEW.active<>1
BEGIN SELECT RAISE(ABORT,'warehouse_default_must_be_active'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `warehouse_tenant_immutable`
BEFORE UPDATE OF `organization_id` ON `warehouses`
WHEN NEW.organization_id<>OLD.organization_id
BEGIN SELECT RAISE(ABORT,'warehouse_tenant_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `warehouse_referenced_no_delete`
BEFORE DELETE ON `warehouses`
WHEN EXISTS (
  SELECT 1 FROM inventory_document_lines l
  WHERE l.organization_id=OLD.organization_id AND l.warehouse_id=OLD.id
) OR EXISTS (
  SELECT 1 FROM inventory_movements m
  WHERE m.organization_id=OLD.organization_id AND m.warehouse_id=OLD.id
)
BEGIN SELECT RAISE(ABORT,'warehouse_in_use'); END;
--> statement-breakpoint

-- New document rows select current active warehouse master data and freeze name/code snapshots.
CREATE TRIGGER IF NOT EXISTS `inventory_line_warehouse_reference_insert`
BEFORE INSERT ON `inventory_document_lines`
BEGIN
  SELECT CASE WHEN NEW.warehouse_id IS NULL
    THEN RAISE(ABORT,'inventory_warehouse_required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.id=NEW.warehouse_id AND w.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'inventory_warehouse_tenant_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.id=NEW.warehouse_id AND w.organization_id=NEW.organization_id AND w.active=1
      AND w.code=NEW.warehouse_code AND w.name=NEW.warehouse_name
  ) THEN RAISE(ABORT,'inventory_warehouse_snapshot_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `inventory_line_warehouse_reference_update`
BEFORE UPDATE OF `organization_id`,`warehouse_id`,`warehouse_code`,`warehouse_name` ON `inventory_document_lines`
BEGIN
  SELECT CASE WHEN NEW.warehouse_id IS NULL
    THEN RAISE(ABORT,'inventory_warehouse_required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.id=NEW.warehouse_id AND w.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'inventory_warehouse_tenant_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM warehouses w
    WHERE w.id=NEW.warehouse_id AND w.organization_id=NEW.organization_id AND w.active=1
      AND w.code=NEW.warehouse_code AND w.name=NEW.warehouse_name
  ) THEN RAISE(ABORT,'inventory_warehouse_snapshot_invalid') END;
END;
--> statement-breakpoint

-- Stock may never become negative inside one warehouse+lot bucket. Another warehouse's balance
-- cannot satisfy a write-off here.
DROP TRIGGER IF EXISTS `inventory_writeoff_nonnegative_stock`;
--> statement-breakpoint
CREATE TRIGGER `inventory_writeoff_nonnegative_stock`
BEFORE INSERT ON `inventory_movements`
WHEN NEW.movement_type='writeoff'
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

-- Extend the exact registrar contract: warehouse identity and historical snapshot are now part of
-- the immutable movement fact alongside item/lot/quantity/reason/booking.
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
      AND l.warehouse_id=NEW.warehouse_id
      AND l.warehouse_code=NEW.warehouse_code AND l.warehouse_name=NEW.warehouse_name
      AND (
        (d.document_type='inventory_receipt' AND NEW.movement_type='receipt'
          AND ABS(NEW.quantity_delta-l.quantity)<0.000001)
        OR
        (d.document_type='inventory_writeoff' AND NEW.movement_type='writeoff'
          AND ABS(NEW.quantity_delta+l.quantity)<0.000001)
      )
  ) THEN RAISE(ABORT,'inventory_document_link_invalid') END;
END;
