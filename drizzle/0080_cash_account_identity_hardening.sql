-- Cash-account classification is part of business identity.
-- A bank account must never silently become a cash drawer (or switch currency) under historical documents.
CREATE TRIGGER IF NOT EXISTS `cash_account_classification_immutable`
BEFORE UPDATE OF `account_type`,`currency` ON `cash_accounts`
WHEN NEW.account_type<>OLD.account_type OR NEW.currency<>OLD.currency
BEGIN SELECT RAISE(ABORT,'cash_account_classification_immutable'); END;
