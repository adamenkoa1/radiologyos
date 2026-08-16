-- BAS reference layer: tenant-scoped counterparties become the canonical identity for suppliers.
-- Existing free-text supplier values remain untouched as historical snapshots; no heuristic backfill.
CREATE TABLE IF NOT EXISTS `counterparties` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `code` text DEFAULT '' NOT NULL,
  `name` text NOT NULL,
  `kind` text DEFAULT 'supplier' NOT NULL CHECK (`kind` IN ('supplier','payer','both','other')),
  `tax_id` text DEFAULT '' NOT NULL,
  `phone` text DEFAULT '' NOT NULL,
  `email` text DEFAULT '' NOT NULL,
  `address` text DEFAULT '' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL CHECK (`active` IN (0,1)),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `counterparties_org_id_idx`
  ON `counterparties` (`organization_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `counterparties_org_code_idx`
  ON `counterparties` (`organization_id`,`code`) WHERE `code` <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `counterparties_org_kind_active_idx`
  ON `counterparties` (`organization_id`,`kind`,`active`,`name`);
--> statement-breakpoint

ALTER TABLE `inventory_document_lines` ADD COLUMN `supplier_counterparty_id` integer;
--> statement-breakpoint
ALTER TABLE `inventory_lots` ADD COLUMN `supplier_counterparty_id` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_document_lines_supplier_idx`
  ON `inventory_document_lines` (`organization_id`,`supplier_counterparty_id`,`document_id`)
  WHERE `supplier_counterparty_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_lots_supplier_idx`
  ON `inventory_lots` (`organization_id`,`supplier_counterparty_id`,`id`)
  WHERE `supplier_counterparty_id` IS NOT NULL;
--> statement-breakpoint

-- Organization is permanent reference identity. Business fields can be edited while the reference exists.
CREATE TRIGGER IF NOT EXISTS `counterparty_identity_immutable`
BEFORE UPDATE OF `organization_id` ON `counterparties`
WHEN NEW.organization_id <> OLD.organization_id
BEGIN SELECT RAISE(ABORT,'counterparty_tenant_immutable'); END;
--> statement-breakpoint

-- New receipt links must resolve to one active supplier/both reference in the same tenant.
-- The free-text supplier field is an explicit selection-time snapshot and must equal the reference name.
CREATE TRIGGER IF NOT EXISTS `inventory_line_supplier_reference_insert`
BEFORE INSERT ON `inventory_document_lines`
WHEN NEW.supplier_counterparty_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'counterparty_supplier_tenant_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
      AND c.active=1 AND c.kind IN ('supplier','both')
  ) THEN RAISE(ABORT,'counterparty_not_active_supplier') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
      AND c.name=NEW.supplier
  ) THEN RAISE(ABORT,'counterparty_supplier_snapshot_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `inventory_line_supplier_reference_update`
BEFORE UPDATE OF `organization_id`,`supplier_counterparty_id`,`supplier` ON `inventory_document_lines`
WHEN NEW.supplier_counterparty_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'counterparty_supplier_tenant_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
      AND c.active=1 AND c.kind IN ('supplier','both')
  ) THEN RAISE(ABORT,'counterparty_not_active_supplier') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
      AND c.name=NEW.supplier
  ) THEN RAISE(ABORT,'counterparty_supplier_snapshot_mismatch') END;
END;
--> statement-breakpoint

-- A posted receipt creates the lot later. It keeps the receipt's supplier snapshot even if the
-- reference was renamed or deactivated between draft creation and posting, but may never cross tenant/type.
CREATE TRIGGER IF NOT EXISTS `inventory_lot_supplier_reference_insert`
BEFORE INSERT ON `inventory_lots`
WHEN NEW.supplier_counterparty_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
      AND c.kind IN ('supplier','both')
  ) THEN RAISE(ABORT,'counterparty_lot_supplier_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `inventory_lot_supplier_reference_update`
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
      AND c.kind IN ('supplier','both')
  ) THEN RAISE(ABORT,'counterparty_lot_supplier_invalid') END;
END;
--> statement-breakpoint

-- Referenced master data is retired through active=0, never deleted out from under historical documents.
CREATE TRIGGER IF NOT EXISTS `counterparty_no_delete_when_referenced`
BEFORE DELETE ON `counterparties`
WHEN EXISTS (
  SELECT 1 FROM inventory_document_lines l
  WHERE l.organization_id=OLD.organization_id AND l.supplier_counterparty_id=OLD.id
) OR EXISTS (
  SELECT 1 FROM inventory_lots l
  WHERE l.organization_id=OLD.organization_id AND l.supplier_counterparty_id=OLD.id
)
BEGIN SELECT RAISE(ABORT,'counterparty_in_use'); END;
