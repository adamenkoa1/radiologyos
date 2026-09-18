-- Drafts may be edited, but tenant/master-data identity and frozen snapshots must stay valid.
CREATE TRIGGER IF NOT EXISTS `supplier_payment_reference_update`
BEFORE UPDATE OF `organization_id`,`supplier_counterparty_id`,`supplier_code`,`supplier_name`,
                 `cash_account_id`,`cash_account_code`,`cash_account_name`,`currency`
ON `supplier_payment_documents`
WHEN OLD.state='draft'
BEGIN
  SELECT CASE WHEN NEW.organization_id<>OLD.organization_id
    THEN RAISE(ABORT,'supplier_payment_tenant_immutable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
      AND c.kind IN ('supplier','both') AND c.code=NEW.supplier_code AND c.name=NEW.supplier_name
  ) THEN RAISE(ABORT,'supplier_payment_supplier_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM cash_accounts a
    WHERE a.id=NEW.cash_account_id AND a.organization_id=NEW.organization_id
      AND a.active=1 AND a.currency=NEW.currency
      AND a.code=NEW.cash_account_code AND a.name=NEW.cash_account_name
  ) THEN RAISE(ABORT,'supplier_payment_cash_account_invalid') END;
END;
--> statement-breakpoint

-- Allocations are immutable in their tenant/payment/receipt identity even while draft;
-- changing an allocation means delete + recreate it before posting.
CREATE TRIGGER IF NOT EXISTS `supplier_payment_allocation_identity_immutable`
BEFORE UPDATE OF `organization_id`,`payment_document_id`,`receipt_document_id`
ON `supplier_payment_allocations`
WHEN NEW.organization_id<>OLD.organization_id
  OR NEW.payment_document_id<>OLD.payment_document_id
  OR NEW.receipt_document_id<>OLD.receipt_document_id
BEGIN SELECT RAISE(ABORT,'supplier_payment_allocation_identity_immutable'); END;
--> statement-breakpoint

-- Strengthen final posting against snapshot drift or supplier/currency changes performed by
-- any future write path before this migration's update guard existed.
CREATE TRIGGER IF NOT EXISTS `supplier_payment_post_snapshot_guard`
BEFORE UPDATE OF `state` ON `supplier_payment_documents`
WHEN OLD.state='draft' AND NEW.state='posted'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id=NEW.supplier_counterparty_id AND c.organization_id=NEW.organization_id
      AND c.kind IN ('supplier','both') AND c.code=NEW.supplier_code AND c.name=NEW.supplier_name
  ) THEN RAISE(ABORT,'supplier_payment_supplier_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM cash_accounts a
    WHERE a.id=NEW.cash_account_id AND a.organization_id=NEW.organization_id
      AND a.active=1 AND a.currency=NEW.currency
      AND a.code=NEW.cash_account_code AND a.name=NEW.cash_account_name
  ) THEN RAISE(ABORT,'supplier_payment_cash_account_invalid') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM supplier_payment_allocations a
    LEFT JOIN supplier_payable_balance b
      ON b.organization_id=a.organization_id
     AND b.receipt_document_id=a.receipt_document_id
     AND b.supplier_counterparty_id=NEW.supplier_counterparty_id
     AND b.currency=NEW.currency
    WHERE a.organization_id=NEW.organization_id AND a.payment_document_id=NEW.id
      AND (b.receipt_document_id IS NULL OR b.balance<=0 OR a.amount>b.balance)
  ) THEN RAISE(ABORT,'supplier_payment_overpay') END;
END;
