-- A canonical supplier on a new receipt means this is a payable purchase.
-- Fail closed if purchasing forgot to value the line before stock posting.
-- Existing historical posted receipts are unaffected because this fires only on draft -> posted.
CREATE TRIGGER IF NOT EXISTS `inventory_receipt_supplier_value_required`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.state='draft' AND NEW.state='posted' AND NEW.document_type='inventory_receipt'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM inventory_document_lines l
    WHERE l.organization_id=NEW.organization_id AND l.document_id=NEW.id
      AND l.supplier_counterparty_id IS NOT NULL
      AND (l.unit_cost <= 0 OR l.line_amount <= 0)
  ) THEN RAISE(ABORT,'inventory_receipt_purchase_value_required') END;
END;
