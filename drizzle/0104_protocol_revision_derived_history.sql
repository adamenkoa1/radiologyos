-- Base protocol history must be a database invariant, not best-effort
-- application logging. Backfill the exact current document when an older row
-- has no snapshot, then derive every subsequent clinical revision in D1.

INSERT OR IGNORE INTO `protocol_revisions`
  (`organization_id`, `booking_id`, `version`, `template_key`, `method`, `sections_json`,
   `findings`, `conclusion`, `recommendations`, `number`, `status`, `saved_by`)
SELECT
  p.`organization_id`, p.`booking_id`, p.`version`, p.`template_key`, p.`method`, p.`sections_json`,
  p.`findings`, p.`conclusion`, p.`recommendations`, p.`number`, p.`status`, p.`updated_by`
FROM `protocols` p
WHERE NOT EXISTS (
  SELECT 1 FROM `protocol_revisions` r
  WHERE r.`organization_id` = p.`organization_id`
    AND r.`booking_id` = p.`booking_id`
    AND r.`version` = p.`version`
);
--> statement-breakpoint

-- New revision rows are only valid as exact snapshots of the current protocol.
-- Historical rows created before this migration stay append-only, but callers
-- can no longer invent or pre-seed arbitrary future history.
CREATE TRIGGER `protocol_revisions_snapshot_guard_insert`
BEFORE INSERT ON `protocol_revisions`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM `protocols` p
  WHERE p.`organization_id` = NEW.`organization_id`
    AND p.`booking_id` = NEW.`booking_id`
    AND p.`version` = NEW.`version`
    AND p.`template_key` = NEW.`template_key`
    AND p.`method` = NEW.`method`
    AND p.`sections_json` = NEW.`sections_json`
    AND p.`findings` = NEW.`findings`
    AND p.`conclusion` = NEW.`conclusion`
    AND p.`recommendations` = NEW.`recommendations`
    AND p.`number` = NEW.`number`
    AND p.`status` = NEW.`status`
    AND p.`updated_by` = NEW.`saved_by`
)
BEGIN
  SELECT RAISE(ABORT, 'protocol revision must match current document');
END;
--> statement-breakpoint

-- Any clinical edit while the report is still editable is a new immutable
-- revision. This includes the ready -> signed transition because the signature
-- binds to that exact finalized version.
CREATE TRIGGER `protocols_revision_version_step_guard`
BEFORE UPDATE ON `protocols`
FOR EACH ROW
WHEN OLD.`status` IN ('draft','ready')
  AND (
       NEW.`template_key` IS NOT OLD.`template_key`
    OR NEW.`method` IS NOT OLD.`method`
    OR NEW.`sections_json` IS NOT OLD.`sections_json`
    OR NEW.`findings` IS NOT OLD.`findings`
    OR NEW.`conclusion` IS NOT OLD.`conclusion`
    OR NEW.`recommendations` IS NOT OLD.`recommendations`
    OR NEW.`number` IS NOT OLD.`number`
    OR NEW.`status` IS NOT OLD.`status`
    OR NEW.`version` IS NOT OLD.`version`
  )
  AND NEW.`version` != OLD.`version` + 1
BEGIN
  SELECT RAISE(ABORT, 'protocol edits require next version');
END;
--> statement-breakpoint

-- Refuse to advance a document whose current state is not already represented
-- by an exact immutable snapshot. This turns previously missing/corrupt history
-- into a fail-closed condition instead of silently overwriting evidence.
CREATE TRIGGER `protocols_revision_current_snapshot_guard`
BEFORE UPDATE ON `protocols`
FOR EACH ROW
WHEN OLD.`status` IN ('draft','ready')
  AND (
       NEW.`template_key` IS NOT OLD.`template_key`
    OR NEW.`method` IS NOT OLD.`method`
    OR NEW.`sections_json` IS NOT OLD.`sections_json`
    OR NEW.`findings` IS NOT OLD.`findings`
    OR NEW.`conclusion` IS NOT OLD.`conclusion`
    OR NEW.`recommendations` IS NOT OLD.`recommendations`
    OR NEW.`number` IS NOT OLD.`number`
    OR NEW.`status` IS NOT OLD.`status`
    OR NEW.`version` IS NOT OLD.`version`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `protocol_revisions` r
    WHERE r.`organization_id` = OLD.`organization_id`
      AND r.`booking_id` = OLD.`booking_id`
      AND r.`version` = OLD.`version`
      AND r.`template_key` = OLD.`template_key`
      AND r.`method` = OLD.`method`
      AND r.`sections_json` = OLD.`sections_json`
      AND r.`findings` = OLD.`findings`
      AND r.`conclusion` = OLD.`conclusion`
      AND r.`recommendations` = OLD.`recommendations`
      AND r.`number` = OLD.`number`
      AND r.`status` = OLD.`status`
  )
BEGIN
  SELECT RAISE(ABORT, 'current protocol revision snapshot missing or mismatched');
END;
--> statement-breakpoint

-- A pre-existing row for the target version must not be able to hide a
-- different payload or attribution behind INSERT OR IGNORE.
CREATE TRIGGER `protocols_revision_target_snapshot_guard`
BEFORE UPDATE ON `protocols`
FOR EACH ROW
WHEN OLD.`status` IN ('draft','ready')
  AND NEW.`version` = OLD.`version` + 1
  AND EXISTS (
    SELECT 1 FROM `protocol_revisions` r
    WHERE r.`organization_id` = NEW.`organization_id`
      AND r.`booking_id` = NEW.`booking_id`
      AND r.`version` = NEW.`version`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `protocol_revisions` r
    WHERE r.`organization_id` = NEW.`organization_id`
      AND r.`booking_id` = NEW.`booking_id`
      AND r.`version` = NEW.`version`
      AND r.`template_key` = NEW.`template_key`
      AND r.`method` = NEW.`method`
      AND r.`sections_json` = NEW.`sections_json`
      AND r.`findings` = NEW.`findings`
      AND r.`conclusion` = NEW.`conclusion`
      AND r.`recommendations` = NEW.`recommendations`
      AND r.`number` = NEW.`number`
      AND r.`status` = NEW.`status`
      AND r.`saved_by` = NEW.`updated_by`
  )
BEGIN
  SELECT RAISE(ABORT, 'target protocol revision snapshot mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER `protocol_revision_snapshot_initial`
AFTER INSERT ON `protocols`
FOR EACH ROW
BEGIN
  INSERT OR IGNORE INTO `protocol_revisions`
    (`organization_id`, `booking_id`, `version`, `template_key`, `method`, `sections_json`,
     `findings`, `conclusion`, `recommendations`, `number`, `status`, `saved_by`)
  VALUES
    (NEW.`organization_id`, NEW.`booking_id`, NEW.`version`, NEW.`template_key`, NEW.`method`, NEW.`sections_json`,
     NEW.`findings`, NEW.`conclusion`, NEW.`recommendations`, NEW.`number`, NEW.`status`, NEW.`updated_by`);
END;
--> statement-breakpoint

CREATE TRIGGER `protocol_revision_snapshot_next`
AFTER UPDATE ON `protocols`
FOR EACH ROW
WHEN NEW.`version` = OLD.`version` + 1
BEGIN
  INSERT OR IGNORE INTO `protocol_revisions`
    (`organization_id`, `booking_id`, `version`, `template_key`, `method`, `sections_json`,
     `findings`, `conclusion`, `recommendations`, `number`, `status`, `saved_by`)
  VALUES
    (NEW.`organization_id`, NEW.`booking_id`, NEW.`version`, NEW.`template_key`, NEW.`method`, NEW.`sections_json`,
     NEW.`findings`, NEW.`conclusion`, NEW.`recommendations`, NEW.`number`, NEW.`status`, NEW.`updated_by`);
END;
