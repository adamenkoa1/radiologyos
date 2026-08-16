-- BAS reference: cash/bank accounts become explicit dimensions of the cash register.
-- Historical finance rows remain NULL and are never heuristically backfilled.
CREATE TABLE IF NOT EXISTS `cash_accounts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `code` text DEFAULT '' NOT NULL,
  `name` text NOT NULL,
  `account_type` text DEFAULT 'cash' NOT NULL CHECK (`account_type` IN ('cash','bank','provider','other')),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL CHECK (`active` IN (0,1)),
  `is_default` integer DEFAULT 0 NOT NULL CHECK (`is_default` IN (0,1)),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cash_accounts_org_id_idx`
  ON `cash_accounts` (`organization_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cash_accounts_org_code_idx`
  ON `cash_accounts` (`organization_id`,`code`) WHERE `code` <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cash_accounts_one_default_idx`
  ON `cash_accounts` (`organization_id`,`account_type`,`currency`) WHERE `is_default`=1;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cash_accounts_org_type_active_idx`
  ON `cash_accounts` (`organization_id`,`account_type`,`currency`,`active`,`name`);
--> statement-breakpoint

INSERT OR IGNORE INTO `cash_accounts` (`organization_id`,`code`,`name`,`account_type`,`currency`,`active`,`is_default`)
SELECT id,'CASH-UAH','Основна каса','cash','UAH',1,1 FROM organizations;
--> statement-breakpoint
INSERT OR IGNORE INTO `cash_accounts` (`organization_id`,`code`,`name`,`account_type`,`currency`,`active`,`is_default`)
SELECT id,'BANK-UAH','Основний банківський рахунок','bank','UAH',1,1 FROM organizations;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_seed_cash_accounts`
AFTER INSERT ON `organizations`
BEGIN
  INSERT OR IGNORE INTO cash_accounts (organization_id,code,name,account_type,currency,active,is_default)
    VALUES (NEW.id,'CASH-UAH','Основна каса','cash','UAH',1,1);
  INSERT OR IGNORE INTO cash_accounts (organization_id,code,name,account_type,currency,active,is_default)
    VALUES (NEW.id,'BANK-UAH','Основний банківський рахунок','bank','UAH',1,1);
END;
--> statement-breakpoint

ALTER TABLE `finance_document_details` ADD COLUMN `cash_account_id` integer;
--> statement-breakpoint
ALTER TABLE `finance_document_details` ADD COLUMN `cash_account_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `finance_document_details` ADD COLUMN `cash_account_code` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `cash_movements` ADD COLUMN `cash_account_id` integer;
--> statement-breakpoint
ALTER TABLE `cash_movements` ADD COLUMN `cash_account_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `cash_movements` ADD COLUMN `cash_account_code` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_document_cash_account_idx`
  ON `finance_document_details` (`organization_id`,`cash_account_id`,`document_id`)
  WHERE `cash_account_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cash_movements_account_time_idx`
  ON `cash_movements` (`organization_id`,`cash_account_id`,`occurred_at` DESC,`id` DESC)
  WHERE `cash_account_id` IS NOT NULL;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `cash_account_tenant_immutable`
BEFORE UPDATE OF `organization_id` ON `cash_accounts`
WHEN NEW.organization_id <> OLD.organization_id
BEGIN SELECT RAISE(ABORT,'cash_account_tenant_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cash_account_referenced_no_delete`
BEFORE DELETE ON `cash_accounts`
WHEN EXISTS (
  SELECT 1 FROM finance_document_details f
  WHERE f.organization_id=OLD.organization_id AND f.cash_account_id=OLD.id
) OR EXISTS (
  SELECT 1 FROM cash_movements m
  WHERE m.organization_id=OLD.organization_id AND m.cash_account_id=OLD.id
)
BEGIN SELECT RAISE(ABORT,'cash_account_in_use'); END;
--> statement-breakpoint

-- Payment selects current active account master data and freezes its name/code snapshot.
-- Refund inherits the exact historical account + snapshot from its source payment when available.
CREATE TRIGGER IF NOT EXISTS `finance_cash_account_reference_insert`
BEFORE INSERT ON `finance_document_details`
WHEN NEW.cash_account_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM cash_accounts a
    WHERE a.id=NEW.cash_account_id AND a.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'cash_account_tenant_mismatch') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='payment'
  ) AND NOT EXISTS (
    SELECT 1 FROM cash_accounts a
    WHERE a.id=NEW.cash_account_id AND a.organization_id=NEW.organization_id
      AND a.active=1 AND a.currency=NEW.currency
      AND a.name=NEW.cash_account_name AND a.code=NEW.cash_account_code
  ) THEN RAISE(ABORT,'cash_account_payment_snapshot_invalid') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    JOIN finance_document_details src
      ON src.document_id=NEW.source_document_id AND src.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='refund' AND src.cash_account_id IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM finance_document_details src
    WHERE src.document_id=NEW.source_document_id AND src.organization_id=NEW.organization_id
      AND src.cash_account_id=NEW.cash_account_id
      AND src.cash_account_name=NEW.cash_account_name
      AND src.cash_account_code=NEW.cash_account_code
      AND src.currency=NEW.currency
  ) THEN RAISE(ABORT,'refund_cash_account_must_match_payment') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='refund'
  ) AND NOT EXISTS (
    SELECT 1 FROM finance_document_details src
    WHERE src.document_id=NEW.source_document_id AND src.organization_id=NEW.organization_id
      AND src.cash_account_id IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM cash_accounts a
    WHERE a.id=NEW.cash_account_id AND a.organization_id=NEW.organization_id
      AND a.active=1 AND a.currency=NEW.currency
      AND a.name=NEW.cash_account_name AND a.code=NEW.cash_account_code
  ) THEN RAISE(ABORT,'cash_account_refund_snapshot_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_cash_account_reference_update`
BEFORE UPDATE OF `cash_account_id`,`cash_account_name`,`cash_account_code`,`currency`,`source_document_id`,`organization_id`
ON `finance_document_details`
WHEN NEW.cash_account_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM cash_accounts a
    WHERE a.id=NEW.cash_account_id AND a.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'cash_account_tenant_mismatch') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.document_type='payment'
  ) AND NOT EXISTS (
    SELECT 1 FROM cash_accounts a
    WHERE a.id=NEW.cash_account_id AND a.organization_id=NEW.organization_id
      AND a.active=1 AND a.currency=NEW.currency
      AND a.name=NEW.cash_account_name AND a.code=NEW.cash_account_code
  ) THEN RAISE(ABORT,'cash_account_payment_snapshot_invalid') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_documents d
    JOIN finance_document_details src
      ON src.document_id=NEW.source_document_id AND src.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='refund' AND src.cash_account_id IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM finance_document_details src
    WHERE src.document_id=NEW.source_document_id AND src.organization_id=NEW.organization_id
      AND src.cash_account_id=NEW.cash_account_id
      AND src.cash_account_name=NEW.cash_account_name
      AND src.cash_account_code=NEW.cash_account_code
      AND src.currency=NEW.currency
  ) THEN RAISE(ABORT,'refund_cash_account_must_match_payment') END;
END;
--> statement-breakpoint

-- Extend the exact registrar contract with account identity and historical snapshot.
DROP TRIGGER IF EXISTS `cash_movement_finance_integrity`;
--> statement-breakpoint
CREATE TRIGGER `cash_movement_finance_integrity`
BEFORE INSERT ON `cash_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM business_documents d
    JOIN finance_document_details f ON f.document_id=d.id AND f.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
      AND f.booking_id=NEW.booking_id AND f.currency=NEW.currency
      AND f.method=NEW.method AND f.provider=NEW.provider AND f.provider_reference=NEW.provider_reference
      AND f.cash_account_id IS NEW.cash_account_id
      AND f.cash_account_name=NEW.cash_account_name AND f.cash_account_code=NEW.cash_account_code
      AND (
        (d.document_type='payment' AND NEW.movement_type='payment' AND NEW.amount_delta=f.amount)
        OR
        (d.document_type='refund' AND NEW.movement_type='refund' AND NEW.amount_delta=-f.amount)
      )
  ) THEN RAISE(ABORT,'cash_movement_document_mismatch') END;
END;
