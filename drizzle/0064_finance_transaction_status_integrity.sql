-- Linked technical payment status must remain consistent with posted BAS finance documents.
-- Without this guard, changing a linked payment from paid to failed/cancelled could evade the
-- one-linked-paid-per-booking partial index and permit a second full economic payment.

CREATE TRIGGER IF NOT EXISTS `payment_transaction_linked_status_insert`
BEFORE INSERT ON `payment_transactions`
WHEN NEW.payment_document_id IS NOT NULL OR NEW.refund_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.refund_document_id IS NOT NULL AND NEW.status <> 'refunded'
    THEN RAISE(ABORT,'refund_transaction_status_mismatch') END;
  SELECT CASE WHEN NEW.payment_document_id IS NOT NULL AND NEW.refund_document_id IS NULL AND NEW.status <> 'paid'
    THEN RAISE(ABORT,'payment_transaction_status_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `payment_transaction_linked_status_update`
BEFORE UPDATE OF `status`,`payment_document_id`,`refund_document_id` ON `payment_transactions`
WHEN NEW.payment_document_id IS NOT NULL OR NEW.refund_document_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.refund_document_id IS NOT NULL AND NEW.status <> 'refunded'
    THEN RAISE(ABORT,'refund_transaction_status_mismatch') END;
  SELECT CASE WHEN NEW.payment_document_id IS NOT NULL AND NEW.refund_document_id IS NULL AND NEW.status <> 'paid'
    THEN RAISE(ABORT,'payment_transaction_status_mismatch') END;
END;
