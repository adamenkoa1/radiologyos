-- Settlement movement must inherit the receipt accrual's historical supplier-name snapshot.
-- The payment document itself may freeze the supplier's current master-data name.
DROP TRIGGER IF EXISTS `supplier_payable_integrity_insert`;
--> statement-breakpoint
CREATE TRIGGER `supplier_payable_integrity_insert`
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
    JOIN supplier_payable_movements accrual
      ON accrual.organization_id=p.organization_id
     AND accrual.receipt_document_id=a.receipt_document_id
     AND accrual.supplier_counterparty_id=p.supplier_counterparty_id
     AND accrual.movement_type='receipt_accrual'
    WHERE p.id=NEW.payment_document_id AND p.organization_id=NEW.organization_id
      AND p.state='posted' AND a.receipt_document_id=NEW.receipt_document_id
      AND p.supplier_counterparty_id=NEW.supplier_counterparty_id
      AND accrual.supplier_name=NEW.supplier_name AND p.currency=NEW.currency
      AND NEW.amount_delta=-a.amount
  ) THEN RAISE(ABORT,'supplier_payable_payment_mismatch') END;
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS `supplier_payment_post_movements`;
--> statement-breakpoint
CREATE TRIGGER `supplier_payment_post_movements`
AFTER UPDATE OF `state` ON `supplier_payment_documents`
WHEN OLD.state='draft' AND NEW.state='posted'
BEGIN
  INSERT INTO supplier_payable_movements (
    organization_id,supplier_counterparty_id,supplier_name,receipt_document_id,payment_document_id,
    movement_type,amount_delta,currency,actor_email,occurred_at
  )
  SELECT NEW.organization_id,NEW.supplier_counterparty_id,accrual.supplier_name,a.receipt_document_id,NEW.id,
         'payment_settlement',-a.amount,NEW.currency,NEW.posted_by,NEW.posted_at
  FROM supplier_payment_allocations a
  JOIN supplier_payable_movements accrual
    ON accrual.organization_id=a.organization_id
   AND accrual.receipt_document_id=a.receipt_document_id
   AND accrual.supplier_counterparty_id=NEW.supplier_counterparty_id
   AND accrual.movement_type='receipt_accrual'
  WHERE a.organization_id=NEW.organization_id AND a.payment_document_id=NEW.id;

  INSERT INTO supplier_cash_movements (
    organization_id,payment_document_id,supplier_counterparty_id,supplier_name,
    cash_account_id,cash_account_code,cash_account_name,amount_delta,currency,actor_email,occurred_at
  ) VALUES (
    NEW.organization_id,NEW.id,NEW.supplier_counterparty_id,NEW.supplier_name,
    NEW.cash_account_id,NEW.cash_account_code,NEW.cash_account_name,-NEW.amount,NEW.currency,NEW.posted_by,NEW.posted_at
  );
END;
