CREATE TABLE IF NOT EXISTS `business_documents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_type` text NOT NULL CHECK (`document_type` IN (
    'patient_order','appointment','service_delivery','payment','refund',
    'inventory_receipt','inventory_writeoff','inventory_transfer','inventory_count',
    'study_performance','result_delivery'
  )),
  `number` text DEFAULT '' NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `state` text DEFAULT 'draft' NOT NULL CHECK (`state` IN ('draft','posted','reversed','cancelled')),
  `comment` text DEFAULT '' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `posted_by` text DEFAULT '' NOT NULL,
  `posted_at` text DEFAULT '' NOT NULL,
  `reversed_document_id` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`),
  FOREIGN KEY (`reversed_document_id`) REFERENCES `business_documents`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `business_documents_org_id_idx`
  ON `business_documents` (`organization_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `business_documents_org_type_number_idx`
  ON `business_documents` (`organization_id`,`document_type`,`number`) WHERE `number` <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `business_documents_org_type_state_idx`
  ON `business_documents` (`organization_id`,`document_type`,`state`,`occurred_at` DESC,`id` DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `inventory_document_lines` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `line_no` integer NOT NULL,
  `item_id` integer NOT NULL,
  `lot_id` integer,
  `lot_number` text DEFAULT '' NOT NULL,
  `expires_on` text DEFAULT '' NOT NULL,
  `supplier` text DEFAULT '' NOT NULL,
  `quantity` real NOT NULL CHECK (`quantity` > 0),
  `reason` text DEFAULT '' NOT NULL,
  `booking_id` integer,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`),
  FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`),
  FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `inventory_document_lines_doc_line_idx`
  ON `inventory_document_lines` (`organization_id`,`document_id`,`line_no`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `inventory_document_lines_org_id_idx`
  ON `inventory_document_lines` (`organization_id`,`id`);
--> statement-breakpoint

ALTER TABLE `inventory_movements` ADD COLUMN `document_id` integer;
--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD COLUMN `document_line_id` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `inventory_movements_document_line_idx`
  ON `inventory_movements` (`organization_id`,`document_line_id`) WHERE `document_line_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inventory_movements_document_idx`
  ON `inventory_movements` (`organization_id`,`document_id`,`id`) WHERE `document_id` IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `printed_form_snapshots` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `form_type` text NOT NULL CHECK (`form_type` IN (
    'invoice','payment_receipt','service_act','referral','protocol','result',
    'inventory_receipt','inventory_writeoff','inventory_transfer','inventory_count','service_note'
  )),
  `template_version` integer DEFAULT 1 NOT NULL CHECK (`template_version` > 0),
  `payload_json` text NOT NULL,
  `generated_by` text NOT NULL,
  `generated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `storage_key` text DEFAULT '' NOT NULL,
  `sha256` text NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `printed_form_snapshots_same_render_idx`
  ON `printed_form_snapshots` (`organization_id`,`document_id`,`form_type`,`template_version`,`sha256`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `printed_form_snapshots_document_idx`
  ON `printed_form_snapshots` (`organization_id`,`document_id`,`id` DESC);
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `inventory_document_lines_tenant_insert`
BEFORE INSERT ON `inventory_document_lines`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM `business_documents` d
      WHERE d.id = NEW.document_id AND d.organization_id = NEW.organization_id
        AND d.document_type IN ('inventory_receipt','inventory_writeoff','inventory_transfer','inventory_count')
    ) THEN RAISE(ABORT,'inventory_document_tenant_mismatch')
    WHEN NOT EXISTS (
      SELECT 1 FROM `inventory_items` i WHERE i.id = NEW.item_id AND i.organization_id = NEW.organization_id
    ) THEN RAISE(ABORT,'inventory_item_tenant_mismatch')
    WHEN NEW.lot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM `inventory_lots` l WHERE l.id = NEW.lot_id AND l.organization_id = NEW.organization_id AND l.item_id = NEW.item_id
    ) THEN RAISE(ABORT,'inventory_lot_tenant_mismatch')
    WHEN NEW.booking_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM `bookings` b WHERE b.id = NEW.booking_id AND b.organization_id = NEW.organization_id
    ) THEN RAISE(ABORT,'inventory_booking_tenant_mismatch')
  END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `business_document_reversal_tenant_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.reversed_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d WHERE d.id=NEW.reversed_document_id AND d.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'business_document_reversal_tenant_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `business_document_reversal_tenant_update`
BEFORE UPDATE OF `reversed_document_id`,`organization_id` ON `business_documents`
WHEN NEW.reversed_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d WHERE d.id=NEW.reversed_document_id AND d.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'business_document_reversal_tenant_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `business_documents_immutable_after_draft`
BEFORE UPDATE ON `business_documents`
WHEN OLD.state <> 'draft'
BEGIN
  SELECT CASE WHEN NOT (
    OLD.state = 'posted' AND NEW.state = 'reversed'
    AND NEW.organization_id = OLD.organization_id
    AND NEW.document_type = OLD.document_type
    AND NEW.number = OLD.number
    AND NEW.occurred_at = OLD.occurred_at
    AND NEW.comment = OLD.comment
    AND NEW.created_by = OLD.created_by
    AND NEW.created_at = OLD.created_at
    AND NEW.posted_by = OLD.posted_by
    AND NEW.posted_at = OLD.posted_at
  ) THEN RAISE(ABORT,'business_document_immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `business_documents_no_delete_posted`
BEFORE DELETE ON `business_documents`
WHEN OLD.state <> 'draft'
BEGIN
  SELECT RAISE(ABORT,'business_document_immutable');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `inventory_document_lines_draft_insert`
BEFORE INSERT ON `inventory_document_lines`
WHEN NOT EXISTS (SELECT 1 FROM `business_documents` d WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='draft')
BEGIN SELECT RAISE(ABORT,'inventory_document_not_draft'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `inventory_document_lines_draft_update`
BEFORE UPDATE ON `inventory_document_lines`
WHEN NOT EXISTS (SELECT 1 FROM `business_documents` d WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft')
BEGIN SELECT RAISE(ABORT,'inventory_document_not_draft'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `inventory_document_lines_draft_delete`
BEFORE DELETE ON `inventory_document_lines`
WHEN NOT EXISTS (SELECT 1 FROM `business_documents` d WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft')
BEGIN SELECT RAISE(ABORT,'inventory_document_not_draft'); END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `inventory_movement_document_integrity`
BEFORE INSERT ON `inventory_movements`
WHEN NEW.document_id IS NOT NULL OR NEW.document_line_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.document_id IS NULL OR NEW.document_line_id IS NULL
      THEN RAISE(ABORT,'inventory_document_link_incomplete')
    WHEN NOT EXISTS (
      SELECT 1
      FROM `business_documents` d
      JOIN `inventory_document_lines` l
        ON l.document_id=d.id AND l.organization_id=d.organization_id
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
        AND l.id=NEW.document_line_id AND l.item_id=NEW.item_id
        AND (l.lot_id IS NULL OR l.lot_id=NEW.lot_id)
    ) THEN RAISE(ABORT,'inventory_document_link_invalid')
  END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `printed_form_snapshots_no_update`
BEFORE UPDATE ON `printed_form_snapshots`
BEGIN SELECT RAISE(ABORT,'printed_form_snapshot_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `printed_form_snapshots_no_delete`
BEFORE DELETE ON `printed_form_snapshots`
BEGIN SELECT RAISE(ABORT,'printed_form_snapshot_immutable'); END;
