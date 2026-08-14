-- Tenant-scoped consumables inventory.
-- Stock is derived from an immutable movement ledger; lots hold traceability metadata.
CREATE TABLE IF NOT EXISTS `inventory_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `sku` text DEFAULT '' NOT NULL,
  `name` text NOT NULL,
  `category` text DEFAULT 'other' NOT NULL,
  `unit` text DEFAULT 'шт' NOT NULL,
  `min_stock` real DEFAULT 0 NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `inventory_items_org_sku_idx`
  ON `inventory_items` (`organization_id`, `sku`) WHERE `sku` <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_items_org_active_idx`
  ON `inventory_items` (`organization_id`, `active`, `name`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `inventory_lots` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `item_id` integer NOT NULL,
  `lot_number` text DEFAULT '' NOT NULL,
  `expires_on` text DEFAULT '' NOT NULL,
  `supplier` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_lots_org_item_idx`
  ON `inventory_lots` (`organization_id`, `item_id`, `expires_on`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `inventory_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `item_id` integer NOT NULL,
  `lot_id` integer NOT NULL,
  `movement_type` text NOT NULL,
  `quantity_delta` real NOT NULL,
  `reason` text DEFAULT '' NOT NULL,
  `booking_id` integer,
  `actor_email` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`),
  FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_movements_org_item_idx`
  ON `inventory_movements` (`organization_id`, `item_id`, `id` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_movements_org_lot_idx`
  ON `inventory_movements` (`organization_id`, `lot_id`, `id` DESC);
