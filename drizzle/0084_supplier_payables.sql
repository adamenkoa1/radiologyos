-- Purchasing/payables without rebuilding the central business_documents registrar.
-- Inventory receipt remains the economic basis of supplier debt. Supplier payments use a
-- dedicated tenant-scoped document because the existing business_documents CHECK reserves
-- `payment`/`refund` for patient cash facts.

ALTER TABLE `inventory_document_lines` ADD COLUMN `unit_cost` integer DEFAULT 0 NOT NULL CHECK (`unit_cost` >= 0);
--> statement-breakpoint
ALTER TABLE `inventory_document_lines` ADD COLUMN `line_amount` integer DEFAULT 0 NOT NULL CHECK (`line_amount` >= 0);
--> statement-breakpoint

-- New purchase valuation is explicit and exact in whole UAH, matching the current finance model.
-- Historical receipt rows stay at zero; no retrospective supplier debt is invented.
CREATE TRIGGER IF NOT EXISTS `inventory_receipt_purchase_value_insert`
BEFORE INSERT ON `inventory_document_lines`
WHEN EXISTS (
  SELECT 1 FROM business_documents d
  WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
    AND d.document_type='inventory_receipt'
)
BEGIN
  SELECT CASE WHEN NEW.unit_cost < 0 OR NEW.line_amount <> CAST(ROUND(NEW.quantity * NEW.unit_cost) AS INTEGER)
    THEN RAISE(ABORT,'inventory_receipt_purchase_value_invalid') END;
  SELECT CASE WHEN NEW.line_amount > 0 AND NEW.supplier_counterparty_id IS NULL
    THEN RAISE(ABORT,'inventory_receipt_payable_supplier_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `inventory_receipt_purchase_value_update`
BEFORE UPDATE OF `quantity`,`unit_cost`,`line_amount`,`supplier_counterparty_id` ON `inventory_document_lines`
WHEN EXISTS (
  SELECT 1 FROM business_documents d
  WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
    AND d.document_type='inventory_receipt'
)
BEGIN
  SELECT CASE WHEN NEW.unit_cost < 0 OR NEW.line_amount <> CAST(ROUND(NEW.quantity * NEW.unit_cost) AS INTEGER)
    THEN RAISE(ABORT,'inventory_receipt_purchase_value_invalid') END;
  SELECT CASE WHEN NEW.line_amount > 0 AND NEW.supplier_counterparty_id IS NULL
    THEN RAISE(ABORT,'inventory_receipt_payable_supplier_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `inventory_writeoff_purchase_value_insert`
BEFORE INSERT ON `inventory_document_lines`
WHEN EXISTS (
  SELECT 1 FROM business_documents d
  WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
    AND d.document_type='inventory_writeoff'
)
AND (NEW.unit_cost <> 0 OR NEW.line_amount <> 0)
BEGIN SELECT RAISE(ABORT,'inventory_writeoff_purchase_value_forbidden'); END;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `supplier_payment_documents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `number` text DEFAULT '' NOT NULL,
  `supplier_counterparty_id` integer NOT NULL,
  `supplier_code` text DEFAULT '' NOT NULL,
  `supplier_name` text NOT NULL,
  `cash_account_id` integer NOT NULL,
  `cash_account_code` text DEFAULT '' NOT NULL,
  `cash_account_name` text NOT NULL,
  `currency` text DEFAULT 'UAH' NOT NULL,
  `amount` integer NOT NULL CHECK (`amount` > 0),
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `state` text DEFAULT 'draft' NOT NULL CHECK (`state` IN ('draft','posted','cancelled')),
  `comment` text DEFAULT '' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `posted_by` text DEFAULT '' NOT NULL,
  `posted_at` text DEFAULT '' NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`),
  FOREIGN KEY (`supplier_counterparty_id`) REFERENCES `counterparties`(`id`),
  FOREIGN KEY (`cash_account_id`) REFERENCES `cash_accounts`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `supplier_payment_org_id_idx`
  ON `supplier_payment_documents` (`organization_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `supplier_payment_org_number_idx`
  ON `supplier_payment_documents` (`organization_id`,`number`) WHERE `number` <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `supplier_payment_supplier_state_idx`
  ON `supplier_payment_documents` (`organization_id`,`supplier_counterparty_id`,`state`,`occurred_at` DESC,`id` DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `supplier_payment_allocations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `payment_document_id` integer NOT NULL,
  `receipt_document_id` integer NOT NULL,
  `amount` integer NOT NULL CHECK (`amount` > 0),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`payment_document_id`,`organization_id`) REFERENCES `supplier_payment_documents`(`id`,`organization_id`),
  FOREIGN KEY (`receipt_document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `supplier_payment_allocation_unique`
  ON `supplier_payment_allocations` (`organization_id`,`payment_document_id`,`receipt_document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `supplier_payment_allocation_receipt_idx`
  ON `supplier_payment_allocations` (`organization_id`,`receipt_document_id`,`id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `supplier_payable_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `supplier_counterparty_id` integer NOT NULL,
  `supplier_name` text NOT NULL,
  `receipt_document_id` integer NOT NULL,
  `payment_document_id` integer,
  `movement_type` text NOT NULL CHECK (`movement_type` IN ('receipt_accrual','payment_settlement')),
  `amount_delta` integer NOT NULL CHECK (`amount_delta` <> 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `actor_email` text NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`receipt_document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`),
  FOREIGN KEY (`payment_document_id`,`organization_id`) REFERENCES `supplier_payment_documents`(`id`,`organization_id`),
  FOREIGN KEY (`supplier_counterparty_id`) REFERENCES `counterparties`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `supplier_payable_receipt_accrual_unique`
  ON `supplier_payable_movements` (`organization_id`,`receipt_document_id`,`supplier_counterparty_id`)
  WHERE `movement_type`='receipt_accrual';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `supplier_payable_payment_allocation_unique`
  ON `supplier_payable_movements` (`organization_id`,`payment_document_id`,`receipt_document_id`)
  WHERE `movement_type`='payment_settlement';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `supplier_payable_supplier_time_idx`
  ON `supplier_payable_movements` (`organization_id`,`supplier_counterparty_id`,`occurred_at` DESC,`id` DESC);
--> statement-breakpoint

-- Patient cash movements remain untouched. Supplier outflows are a separate physical partition,
-- exposed together through cash_account_balance below.
CREATE TABLE IF NOT EXISTS `supplier_cash_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `payment_document_id` integer NOT NULL,
  `supplier_counterparty_id` integer NOT NULL,
  `supplier_name` text NOT NULL,
  `cash_account_id` integer NOT NULL,
  `cash_account_code` text DEFAULT '' NOT NULL,
  `cash_account_name` text NOT NULL,
  `amount_delta` integer NOT NULL CHECK (`amount_delta` < 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `actor_email` text NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`payment_document_id`,`organization_id`) REFERENCES `supplier_payment_documents`(`id`,`organization_id`),
  FOREIGN KEY (`supplier_counterparty_id`) REFERENCES `counterparties`(`id`),
  FOREIGN KEY (`cash_account_id`) REFERENCES `cash_accounts`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `supplier_cash_payment_unique`
  ON `supplier_cash_movements` (`organization_id`,`payment_document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `supplier_cash_account_time_idx`
  ON `supplier_cash_movements` (`organization_id`,`cash_account_id`,`occurred_at` DESC,`id` DESC);
--> statement-breakpoint

-- Append-only register evidence.
CREATE TRIGGER IF NOT EXISTS `supplier_payable_no_update` BEFORE UPDATE ON `supplier_payable_movements`
BEGIN SELECT RAISE(ABORT,'supplier_payable_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_payable_no_delete` BEFORE DELETE ON `supplier_payable_movements`
BEGIN SELECT RAISE(ABORT,'supplier_payable_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_cash_no_update` BEFORE UPDATE ON `supplier_cash_movements`
BEGIN SELECT RAISE(ABORT,'supplier_cash_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_cash_no_delete` BEFORE DELETE ON `supplier_cash_movements`
BEGIN SELECT RAISE(ABORT,'supplier_cash_movement_immutable'); END;
--> statement-breakpoint

-- Receipt posting automatically recognizes supplier debt exactly once per supplier.
CREATE TRIGGER IF NOT EXISTS `inventory_receipt_supplier_payable_post`
AFTER UPDATE OF `state` ON `business_documents`
WHEN OLD.state='draft' AND NEW.state='posted' AND NEW.document_type='inventory_receipt'
BEGIN
  INSERT INTO supplier_payable_movements (
    organization_id,supplier_counterparty_id,supplier_name,receipt_document_id,payment_document_id,
    movement_type,amount_delta,currency,actor_email,occurred_at
  )
  SELECT NEW.organization_id,l.supplier_counterparty_id,l.supplier,NEW.id,NULL,
         'receipt_accrual',SUM(l.line_amount),'UAH',NEW.posted_by,NEW.posted_at
  FROM inventory_document_lines l
  WHERE l.organization_id=NEW.organization_id AND l.document_id=NEW.id
    AND l.supplier_counterparty_id IS NOT NULL AND l.line_amount > 0
  GROUP BY l.supplier_counterparty_id,l.supplier;
END;
--> statement-breakpoint

-- Every payable movement must be an exact projection of its registrar/allocation.
CREATE TRIGGER IF NOT EXISTS `supplier_payable_integrity_insert`
BEFORE INSERT ON `supplier_payable_movements`
BEGIN
  SELECT CASE WHEN NEW.movement_type='receipt_accrual' AND NOT EXISTS (
    SELECT 1
    FROM business_documents d
    JOIN inventory_document_lines l ON l.document_id=d.id AND l.organization_id=d.organization_id
    WHERE d.id=NEW.receipt_document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='inventory_receipt' AND d.state='posted'
      AND l.supplier_counterparty_id=NEW.supplier_counterparty_id AND l.supplier=NEW.supplier_name
    GROUP BY d.id,l.supplier_counterparty_id,l.supplier
    HAVING NEW.payment_document_id IS NULL
      AND NEW.amount_delta=SUM(l.line_amount) AND NEW.amount_delta>0 AND NEW.currency='UAH'
  ) THEN RAISE(ABORT,'supplier_payable_receipt_mismatch') END;

  SELECT CASE WHEN NEW.movement_type='payment_settlement' AND NOT EXISTS (
    SELECT 1
    FROM supplier_payment_documents p
    JOIN supplier_payment_allocations a
      ON a.payment_document_id=p.id AND a.organization_id=p.organization_id
    WHERE p.id=NEW.payment_document_id AND p.organization_id=NEW.organization_id
      AND p.state='posted' AND a.receipt_document_id=NEW.receipt_document_id
      AND p.supplier_counterparty_id=NEW.supplier_counterparty_id
      AND p.supplier_name=NEW.supplier_name AND p.currency=NEW.currency
      AND NEW.amount_delta=-a.amount
  ) THEN RAISE(ABORT,'supplier_payable_payment_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `supplier_cash_integrity_insert`
BEFORE INSERT ON `supplier_cash_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM supplier_payment_documents p
    WHERE p.id=NEW.payment_document_id AND p.organization_id=NEW.organization_id AND p.state='posted'
      AND p.supplier_counterparty_id=NEW.supplier_counterparty_id AND p.supplier_name=NEW.supplier_name
      AND p.cash_account_id=NEW.cash_account_id AND p.cash_account_code=NEW.cash_account_code
      AND p.cash_account_name=NEW.cash_account_name AND p.currency=NEW.currency
      AND NEW.amount_delta=-p.amount
  ) THEN RAISE(ABORT,'supplier_cash_payment_mismatch') END;
END;
--> statement-breakpoint

-- Payment document and allocations are mutable only while draft.
CREATE TRIGGER IF NOT EXISTS `supplier_payment_insert_draft_only`
BEFORE INSERT ON `supplier_payment_documents`
WHEN NEW.state<>'draft'
BEGIN SELECT RAISE(ABORT,'supplier_payment_must_start_draft'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_payment_reference_insert`
BEFORE INSERT ON `supplier_payment_documents`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
      AND c.kind IN ('supplier','both') AND c.name=NEW.supplier_name AND c.code=NEW.supplier_code
  ) THEN RAISE(ABORT,'supplier_payment_supplier_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM cash_accounts a
    WHERE a.id=NEW.cash_account_id AND a.organization_id=NEW.organization_id
      AND a.active=1 AND a.currency=NEW.currency
      AND a.name=NEW.cash_account_name AND a.code=NEW.cash_account_code
  ) THEN RAISE(ABORT,'supplier_payment_cash_account_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_payment_immutable_after_draft`
BEFORE UPDATE ON `supplier_payment_documents`
WHEN OLD.state<>'draft'
BEGIN SELECT RAISE(ABORT,'supplier_payment_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_payment_no_delete_after_draft`
BEFORE DELETE ON `supplier_payment_documents`
WHEN OLD.state<>'draft'
BEGIN SELECT RAISE(ABORT,'supplier_payment_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_payment_allocation_insert_integrity`
BEFORE INSERT ON `supplier_payment_allocations`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM supplier_payment_documents p
    WHERE p.id=NEW.payment_document_id AND p.organization_id=NEW.organization_id AND p.state='draft'
  ) THEN RAISE(ABORT,'supplier_payment_allocation_parent_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM supplier_payment_documents p
    JOIN supplier_payable_movements m
      ON m.organization_id=p.organization_id
     AND m.supplier_counterparty_id=p.supplier_counterparty_id
     AND m.receipt_document_id=NEW.receipt_document_id
     AND m.movement_type='receipt_accrual'
    WHERE p.id=NEW.payment_document_id AND p.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'supplier_payment_allocation_receipt_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_payment_allocation_update_draft`
BEFORE UPDATE ON `supplier_payment_allocations`
WHEN NOT EXISTS (
  SELECT 1 FROM supplier_payment_documents p
  WHERE p.id=OLD.payment_document_id AND p.organization_id=OLD.organization_id AND p.state='draft'
)
BEGIN SELECT RAISE(ABORT,'supplier_payment_allocation_not_draft'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_payment_allocation_delete_draft`
BEFORE DELETE ON `supplier_payment_allocations`
WHEN NOT EXISTS (
  SELECT 1 FROM supplier_payment_documents p
  WHERE p.id=OLD.payment_document_id AND p.organization_id=OLD.organization_id AND p.state='draft'
)
BEGIN SELECT RAISE(ABORT,'supplier_payment_allocation_not_draft'); END;
--> statement-breakpoint

-- Posting is atomic: allocation total must equal document amount, no allocation may exceed
-- the outstanding balance of its exact supplier/receipt debt, and the selected cash account
-- must still be active in the same tenant.
CREATE TRIGGER IF NOT EXISTS `supplier_payment_post_guard`
BEFORE UPDATE OF `state` ON `supplier_payment_documents`
WHEN OLD.state='draft' AND NEW.state='posted'
BEGIN
  SELECT CASE WHEN NEW.organization_id<>OLD.organization_id
    OR NEW.supplier_counterparty_id<>OLD.supplier_counterparty_id
    OR NEW.cash_account_id<>OLD.cash_account_id
    THEN RAISE(ABORT,'supplier_payment_identity_immutable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM cash_accounts a
    WHERE a.id=NEW.cash_account_id AND a.organization_id=NEW.organization_id
      AND a.active=1 AND a.currency=NEW.currency
  ) THEN RAISE(ABORT,'supplier_payment_cash_account_inactive') END;
  SELECT CASE WHEN COALESCE((
    SELECT SUM(a.amount) FROM supplier_payment_allocations a
    WHERE a.organization_id=NEW.organization_id AND a.payment_document_id=NEW.id
  ),0)<>NEW.amount THEN RAISE(ABORT,'supplier_payment_allocation_total_mismatch') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM supplier_payment_allocations a
    WHERE a.organization_id=NEW.organization_id AND a.payment_document_id=NEW.id
      AND a.amount > COALESCE((
        SELECT SUM(m.amount_delta) FROM supplier_payable_movements m
        WHERE m.organization_id=NEW.organization_id
          AND m.supplier_counterparty_id=NEW.supplier_counterparty_id
          AND m.receipt_document_id=a.receipt_document_id
      ),0)
  ) THEN RAISE(ABORT,'supplier_payment_overpay') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_payment_state_guard`
BEFORE UPDATE OF `state` ON `supplier_payment_documents`
WHEN NOT (
  (OLD.state='draft' AND NEW.state IN ('draft','posted','cancelled'))
  OR OLD.state=NEW.state
)
BEGIN SELECT RAISE(ABORT,'supplier_payment_state_invalid'); END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `supplier_payment_post_movements`
AFTER UPDATE OF `state` ON `supplier_payment_documents`
WHEN OLD.state='draft' AND NEW.state='posted'
BEGIN
  INSERT INTO supplier_payable_movements (
    organization_id,supplier_counterparty_id,supplier_name,receipt_document_id,payment_document_id,
    movement_type,amount_delta,currency,actor_email,occurred_at
  )
  SELECT NEW.organization_id,NEW.supplier_counterparty_id,NEW.supplier_name,a.receipt_document_id,NEW.id,
         'payment_settlement',-a.amount,NEW.currency,NEW.posted_by,NEW.posted_at
  FROM supplier_payment_allocations a
  WHERE a.organization_id=NEW.organization_id AND a.payment_document_id=NEW.id;

  INSERT INTO supplier_cash_movements (
    organization_id,payment_document_id,supplier_counterparty_id,supplier_name,
    cash_account_id,cash_account_code,cash_account_name,amount_delta,currency,actor_email,occurred_at
  ) VALUES (
    NEW.organization_id,NEW.id,NEW.supplier_counterparty_id,NEW.supplier_name,
    NEW.cash_account_id,NEW.cash_account_code,NEW.cash_account_name,-NEW.amount,NEW.currency,NEW.posted_by,NEW.posted_at
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `supplier_payment_counterparty_no_delete`
BEFORE DELETE ON `counterparties`
WHEN EXISTS (
  SELECT 1 FROM supplier_payment_documents p
  WHERE p.organization_id=OLD.organization_id AND p.supplier_counterparty_id=OLD.id
) OR EXISTS (
  SELECT 1 FROM supplier_payable_movements m
  WHERE m.organization_id=OLD.organization_id AND m.supplier_counterparty_id=OLD.id
)
BEGIN SELECT RAISE(ABORT,'counterparty_in_use'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `supplier_payment_cash_account_no_delete`
BEFORE DELETE ON `cash_accounts`
WHEN EXISTS (
  SELECT 1 FROM supplier_payment_documents p
  WHERE p.organization_id=OLD.organization_id AND p.cash_account_id=OLD.id
) OR EXISTS (
  SELECT 1 FROM supplier_cash_movements m
  WHERE m.organization_id=OLD.organization_id AND m.cash_account_id=OLD.id
)
BEGIN SELECT RAISE(ABORT,'cash_account_in_use'); END;
--> statement-breakpoint

CREATE VIEW IF NOT EXISTS `supplier_payable_balance` AS
SELECT organization_id,supplier_counterparty_id,supplier_name,receipt_document_id,currency,
       SUM(amount_delta) AS balance
FROM supplier_payable_movements
GROUP BY organization_id,supplier_counterparty_id,supplier_name,receipt_document_id,currency;
--> statement-breakpoint

CREATE VIEW IF NOT EXISTS `cash_account_balance` AS
SELECT organization_id,cash_account_id,currency,SUM(amount_delta) AS balance
FROM (
  SELECT organization_id,cash_account_id,currency,amount_delta FROM cash_movements WHERE cash_account_id IS NOT NULL
  UNION ALL
  SELECT organization_id,cash_account_id,currency,amount_delta FROM supplier_cash_movements
)
GROUP BY organization_id,cash_account_id,currency;
