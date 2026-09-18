-- Finalized clinical reports must satisfy the same minimum completeness rule
-- enforced by the application: a protocol in ready/signed/issued state has a
-- non-empty protocol number and conclusion. Existing historical rows are not
-- rewritten; any future mutation must leave a finalized row complete.

CREATE TRIGGER `protocols_finalized_completeness_guard_insert`
BEFORE INSERT ON `protocols`
FOR EACH ROW
WHEN NEW.`status` IN ('ready','signed','issued')
 AND (
   LENGTH(TRIM(COALESCE(NEW.`number`, ''), char(9) || char(10) || char(13) || char(32) || char(160))) = 0
   OR LENGTH(TRIM(COALESCE(NEW.`conclusion`, ''), char(9) || char(10) || char(13) || char(32) || char(160))) = 0
 )
BEGIN
  SELECT RAISE(ABORT, 'finalized protocol requires number and conclusion');
END;
--> statement-breakpoint

CREATE TRIGGER `protocols_finalized_completeness_guard_update`
BEFORE UPDATE ON `protocols`
FOR EACH ROW
WHEN NEW.`status` IN ('ready','signed','issued')
 AND (
   LENGTH(TRIM(COALESCE(NEW.`number`, ''), char(9) || char(10) || char(13) || char(32) || char(160))) = 0
   OR LENGTH(TRIM(COALESCE(NEW.`conclusion`, ''), char(9) || char(10) || char(13) || char(32) || char(160))) = 0
 )
BEGIN
  SELECT RAISE(ABORT, 'finalized protocol requires number and conclusion');
END;
