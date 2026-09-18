-- A refund may carry both a business source document and a technical source transaction.
-- When both are present they must describe the same original payment, not merely two valid
-- same-tenant objects selected independently.

CREATE TRIGGER IF NOT EXISTS `finance_refund_source_crosslink_insert`
BEFORE INSERT ON `finance_document_details`
WHEN NEW.source_document_id IS NOT NULL AND NEW.source_transaction_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `payment_transactions` p
    WHERE p.id=NEW.source_transaction_id
      AND p.organization_id=NEW.organization_id
      AND p.payment_document_id=NEW.source_document_id
  ) THEN RAISE(ABORT,'finance_refund_source_crosslink_invalid') END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `finance_refund_source_crosslink_update`
BEFORE UPDATE OF `source_document_id`,`source_transaction_id`,`organization_id`
ON `finance_document_details`
WHEN NEW.source_document_id IS NOT NULL AND NEW.source_transaction_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `payment_transactions` p
    WHERE p.id=NEW.source_transaction_id
      AND p.organization_id=NEW.organization_id
      AND p.payment_document_id=NEW.source_document_id
  ) THEN RAISE(ABORT,'finance_refund_source_crosslink_invalid') END;
END;
