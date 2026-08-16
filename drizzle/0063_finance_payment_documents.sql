-- BAS-style finance registrar for confirmed payments and refunds.
-- Existing payment_transactions remain legacy when document ids are NULL; no heuristic backfill.

ALTER TABLE `payment_transactions` ADD COLUMN `payment_document_id` integer;
--> statement-breakpoint
ALTER TABLE `payment_transactions` ADD COLUMN `refund_document_id` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `payment_transactions_payment_document_idx`
  ON `payment_transactions` (`organization_id`,`payment_document_id`) WHERE `payment_document_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `payment_transactions_refund_document_idx`
  ON `payment_transactions` (`organization_id`,`refund_document_id`) WHERE `refund_document_id` IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `finance_document_details` (
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `patient_id` text DEFAULT '' NOT NULL,
  `amount` integer NOT NULL CHECK (`amount` > 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `method` text DEFAULT '' NOT NULL,
  `provider` text DEFAULT '' NOT NULL,
  `provider_reference` text DEFAULT '' NOT NULL,
  `source_document_id` integer,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`document_id`),
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`),
  FOREIGN KEY (`source_document_id`) REFERENCES `business_documents`(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_document_details_booking_idx`
  ON `finance_document_details` (`organization_id`,`booking_id`,`document_id` DESC);
--> statement-breakpoint

-- Positive cash delta means money entered the organization; negative means money left it.
CREATE TABLE IF NOT EXISTS `cash_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `movement_type` text NOT NULL CHECK (`movement_type` IN ('payment','refund')),
  `amount_delta` integer NOT NULL CHECK (`amount_delta` <> 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `method` text DEFAULT '' NOT NULL,
  `provider` text DEFAULT '' NOT NULL,
  `provider_reference` text DEFAULT '' NOT NULL,
  `actor_email` text NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cash_movements_document_idx`
  ON `cash_movements` (`organization_id`,`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cash_movements_time_idx`
  ON `cash_movements` (`organization_id`,`occurred_at` DESC,`id` DESC);
--> statement-breakpoint

-- Patient balance convention: positive = patient owes the organization; negative = patient credit.
-- Payment reduces the balance, refund increases it. Service delivery will add a positive charge.
CREATE TABLE IF NOT EXISTS `patient_settlement_movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `document_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `patient_id` text DEFAULT '' NOT NULL,
  `movement_type` text NOT NULL CHECK (`movement_type` IN ('charge','payment','refund','adjustment')),
  `amount_delta` integer NOT NULL CHECK (`amount_delta` <> 0),
  `currency` text DEFAULT 'UAH' NOT NULL,
  `actor_email` text NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`,`organization_id`) REFERENCES `business_documents`(`id`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `patient_settlement_document_idx`
  ON `patient_settlement_movements` (`organization_id`,`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_settlement_patient_idx`
  ON `patient_settlement_movements` (`organization_id`,`patient_id`,`occurred_at` DESC,`id` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_settlement_booking_idx`
  ON `patient_settlement_movements` (`organization_id`,`booking_id`,`id` DESC);
--> statement-breakpoint

-- Finance details are allowed only for payment/refund documents in the same tenant and booking scope.
CREATE TRIGGER IF NOT EXISTS `finance_document_details_integrity_insert`
BEFORE INSERT ON `finance_document_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type IN ('payment','refund') AND d.state='draft'
  ) THEN RAISE(ABORT,'finance_document_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `bookings` b WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'finance_booking_tenant_mismatch') END;
  SELECT CASE WHEN NEW.patient_id <> '' AND NOT EXISTS (
    SELECT 1 FROM `patient_profiles` p WHERE p.patient_id=NEW.patient_id AND p.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'finance_patient_tenant_mismatch') END;
  SELECT CASE WHEN NEW.source_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `business_documents` s
    WHERE s.id=NEW.source_document_id AND s.organization_id=NEW.organization_id AND s.state IN ('posted','reversed')
  ) THEN RAISE(ABORT,'finance_source_document_tenant_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_document_details_draft_update`
BEFORE UPDATE ON `finance_document_details`
WHEN NOT EXISTS (
  SELECT 1 FROM `business_documents` d
  WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft'
)
BEGIN SELECT RAISE(ABORT,'finance_document_not_draft'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_document_details_draft_delete`
BEFORE DELETE ON `finance_document_details`
WHEN NOT EXISTS (
  SELECT 1 FROM `business_documents` d
  WHERE d.id=OLD.document_id AND d.organization_id=OLD.organization_id AND d.state='draft'
)
BEGIN SELECT RAISE(ABORT,'finance_document_not_draft'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_document_details_integrity_update`
BEFORE UPDATE ON `finance_document_details`
BEGIN
  SELECT CASE WHEN NEW.organization_id <> OLD.organization_id OR NEW.document_id <> OLD.document_id
    THEN RAISE(ABORT,'finance_document_identity_immutable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `bookings` b WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'finance_booking_tenant_mismatch') END;
  SELECT CASE WHEN NEW.patient_id <> '' AND NOT EXISTS (
    SELECT 1 FROM `patient_profiles` p WHERE p.patient_id=NEW.patient_id AND p.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'finance_patient_tenant_mismatch') END;
  SELECT CASE WHEN NEW.source_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `business_documents` s
    WHERE s.id=NEW.source_document_id AND s.organization_id=NEW.organization_id AND s.state IN ('posted','reversed')
  ) THEN RAISE(ABORT,'finance_source_document_tenant_mismatch') END;
END;
--> statement-breakpoint

-- Register movements are append-only evidence.
CREATE TRIGGER IF NOT EXISTS `cash_movements_no_update`
BEFORE UPDATE ON `cash_movements`
BEGIN SELECT RAISE(ABORT,'cash_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cash_movements_no_delete`
BEFORE DELETE ON `cash_movements`
BEGIN SELECT RAISE(ABORT,'cash_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_settlement_movements_no_update`
BEFORE UPDATE ON `patient_settlement_movements`
BEGIN SELECT RAISE(ABORT,'patient_settlement_movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_settlement_movements_no_delete`
BEFORE DELETE ON `patient_settlement_movements`
BEGIN SELECT RAISE(ABORT,'patient_settlement_movement_immutable'); END;
--> statement-breakpoint

-- Exact registrar contract: signs, amount, booking, currency and payment metadata must match the posted document.
CREATE TRIGGER IF NOT EXISTS `cash_movement_finance_integrity`
BEFORE INSERT ON `cash_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `finance_document_details` f
      ON f.document_id=d.id AND f.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
      AND f.booking_id=NEW.booking_id
      AND f.currency=NEW.currency
      AND f.method=NEW.method
      AND f.provider=NEW.provider
      AND f.provider_reference=NEW.provider_reference
      AND (
        (d.document_type='payment' AND NEW.movement_type='payment' AND NEW.amount_delta=f.amount)
        OR
        (d.document_type='refund' AND NEW.movement_type='refund' AND NEW.amount_delta=-f.amount)
      )
  ) THEN RAISE(ABORT,'cash_movement_document_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `patient_settlement_finance_integrity`
BEFORE INSERT ON `patient_settlement_movements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `finance_document_details` f
      ON f.document_id=d.id AND f.organization_id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.state='posted'
      AND f.booking_id=NEW.booking_id
      AND f.patient_id=NEW.patient_id
      AND f.currency=NEW.currency
      AND (
        (d.document_type='payment' AND NEW.movement_type='payment' AND NEW.amount_delta=-f.amount)
        OR
        (d.document_type='refund' AND NEW.movement_type='refund' AND NEW.amount_delta=f.amount)
      )
  ) THEN RAISE(ABORT,'patient_settlement_document_mismatch') END;
END;
--> statement-breakpoint

-- New transaction links must point at the exact posted payment/refund registrar.
CREATE TRIGGER IF NOT EXISTS `payment_transaction_document_integrity_insert`
BEFORE INSERT ON `payment_transactions`
BEGIN
  SELECT CASE WHEN NEW.payment_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `finance_document_details` f ON f.document_id=d.id AND f.organization_id=d.organization_id
    WHERE d.id=NEW.payment_document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='payment' AND d.state='posted'
      AND f.booking_id=NEW.booking_id AND f.amount=NEW.amount AND f.currency=NEW.currency
      AND f.provider=NEW.provider AND f.provider_reference=NEW.provider_reference
  ) THEN RAISE(ABORT,'payment_document_link_invalid') END;
  SELECT CASE WHEN NEW.refund_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `finance_document_details` f ON f.document_id=d.id AND f.organization_id=d.organization_id
    WHERE d.id=NEW.refund_document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='refund' AND d.state='posted'
      AND f.booking_id=NEW.booking_id AND f.amount=NEW.amount AND f.currency=NEW.currency
      AND f.provider=NEW.provider AND f.provider_reference=NEW.provider_reference
  ) THEN RAISE(ABORT,'refund_document_link_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `payment_transaction_document_integrity_update`
BEFORE UPDATE OF `payment_document_id`,`refund_document_id`,`organization_id`,`booking_id`,`amount`,`currency`,`provider`,`provider_reference`
ON `payment_transactions`
BEGIN
  SELECT CASE WHEN OLD.payment_document_id IS NOT NULL AND NEW.payment_document_id IS NOT OLD.payment_document_id
    THEN RAISE(ABORT,'payment_document_link_immutable') END;
  SELECT CASE WHEN OLD.refund_document_id IS NOT NULL AND NEW.refund_document_id IS NOT OLD.refund_document_id
    THEN RAISE(ABORT,'refund_document_link_immutable') END;
  SELECT CASE WHEN NEW.payment_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `finance_document_details` f ON f.document_id=d.id AND f.organization_id=d.organization_id
    WHERE d.id=NEW.payment_document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='payment' AND d.state='posted'
      AND f.booking_id=NEW.booking_id AND f.amount=NEW.amount AND f.currency=NEW.currency
      AND f.provider=NEW.provider AND f.provider_reference=NEW.provider_reference
  ) THEN RAISE(ABORT,'payment_document_link_invalid') END;
  SELECT CASE WHEN NEW.refund_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    JOIN `finance_document_details` f ON f.document_id=d.id AND f.organization_id=d.organization_id
    WHERE d.id=NEW.refund_document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='refund' AND d.state='posted'
      AND f.booking_id=NEW.booking_id AND f.amount=NEW.amount AND f.currency=NEW.currency
      AND f.provider=NEW.provider AND f.provider_reference=NEW.provider_reference
  ) THEN RAISE(ABORT,'refund_document_link_invalid') END;
END;
--> statement-breakpoint

-- Payment/refund receipts use the shared immutable printed-form snapshot store.
CREATE TRIGGER IF NOT EXISTS `printed_finance_snapshot_integrity`
BEFORE INSERT ON `printed_form_snapshots`
WHEN NEW.form_type='payment_receipt'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `business_documents` d
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type IN ('payment','refund') AND d.state=NEW.document_state
  ) THEN RAISE(ABORT,'printed_form_document_mismatch') END;
END;
