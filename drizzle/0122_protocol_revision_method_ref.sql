-- Джерело методики (method_ref) має бути частиною незмінної клінічної історії.
-- Раніше воно жило лише в `protocols` (додане 0116), тож зміна джерела методики
-- не фіксувалась у версіях `protocol_revisions`, а derived-history тригери 0104
-- його не порівнювали. Додаємо колонку, вирівнюємо знімок ПОТОЧНОЇ версії з
-- документом і включаємо method_ref у всі snapshot/guard-тригери, щоб зміна
-- method_ref теж вимагала нової версії й потрапляла в історію.

ALTER TABLE `protocol_revisions` ADD `method_ref` text DEFAULT '' NOT NULL;
--> statement-breakpoint

-- Бекфіл можливий лише зі знятим append-only update-guard (0047); одразу після
-- вирівнювання відновлюємо його незмінним. Delete-guard не чіпаємо.
DROP TRIGGER `protocol_revisions_append_only_update`;
--> statement-breakpoint

-- Вирівнюємо знімок поточної версії з протоколом, інакше current-snapshot-guard
-- вважав би його розбіжним після включення method_ref у порівняння. Старіші
-- версії лишаються з '' (історичне значення невідновлюване — чесно).
UPDATE `protocol_revisions`
SET `method_ref` = COALESCE((
  SELECT p.`method_ref` FROM `protocols` p
  WHERE p.`organization_id` = `protocol_revisions`.`organization_id`
    AND p.`booking_id` = `protocol_revisions`.`booking_id`
    AND p.`version` = `protocol_revisions`.`version`
), '')
WHERE EXISTS (
  SELECT 1 FROM `protocols` p
  WHERE p.`organization_id` = `protocol_revisions`.`organization_id`
    AND p.`booking_id` = `protocol_revisions`.`booking_id`
    AND p.`version` = `protocol_revisions`.`version`
);
--> statement-breakpoint

CREATE TRIGGER `protocol_revisions_append_only_update`
BEFORE UPDATE ON `protocol_revisions`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'protocol revisions are append-only');
END;
--> statement-breakpoint

-- Знімок має точно відповідати поточному документу, тепер включно з method_ref.
DROP TRIGGER `protocol_revisions_snapshot_guard_insert`;
--> statement-breakpoint
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
    AND p.`method_ref` = NEW.`method_ref`
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

-- Редагування method_ref у редагованому протоколі теж є новою версією.
DROP TRIGGER `protocols_revision_version_step_guard`;
--> statement-breakpoint
CREATE TRIGGER `protocols_revision_version_step_guard`
BEFORE UPDATE ON `protocols`
FOR EACH ROW
WHEN OLD.`status` IN ('draft','ready')
  AND (
       NEW.`template_key` IS NOT OLD.`template_key`
    OR NEW.`method` IS NOT OLD.`method`
    OR NEW.`method_ref` IS NOT OLD.`method_ref`
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

DROP TRIGGER `protocols_revision_current_snapshot_guard`;
--> statement-breakpoint
CREATE TRIGGER `protocols_revision_current_snapshot_guard`
BEFORE UPDATE ON `protocols`
FOR EACH ROW
WHEN OLD.`status` IN ('draft','ready')
  AND (
       NEW.`template_key` IS NOT OLD.`template_key`
    OR NEW.`method` IS NOT OLD.`method`
    OR NEW.`method_ref` IS NOT OLD.`method_ref`
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
      AND r.`method_ref` = OLD.`method_ref`
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

DROP TRIGGER `protocols_revision_target_snapshot_guard`;
--> statement-breakpoint
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
      AND r.`method_ref` = NEW.`method_ref`
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

DROP TRIGGER `protocol_revision_snapshot_initial`;
--> statement-breakpoint
CREATE TRIGGER `protocol_revision_snapshot_initial`
AFTER INSERT ON `protocols`
FOR EACH ROW
BEGIN
  INSERT OR IGNORE INTO `protocol_revisions`
    (`organization_id`, `booking_id`, `version`, `template_key`, `method`, `method_ref`, `sections_json`,
     `findings`, `conclusion`, `recommendations`, `number`, `status`, `saved_by`)
  VALUES
    (NEW.`organization_id`, NEW.`booking_id`, NEW.`version`, NEW.`template_key`, NEW.`method`, NEW.`method_ref`, NEW.`sections_json`,
     NEW.`findings`, NEW.`conclusion`, NEW.`recommendations`, NEW.`number`, NEW.`status`, NEW.`updated_by`);
END;
--> statement-breakpoint

DROP TRIGGER `protocol_revision_snapshot_next`;
--> statement-breakpoint
CREATE TRIGGER `protocol_revision_snapshot_next`
AFTER UPDATE ON `protocols`
FOR EACH ROW
WHEN NEW.`version` = OLD.`version` + 1
BEGIN
  INSERT OR IGNORE INTO `protocol_revisions`
    (`organization_id`, `booking_id`, `version`, `template_key`, `method`, `method_ref`, `sections_json`,
     `findings`, `conclusion`, `recommendations`, `number`, `status`, `saved_by`)
  VALUES
    (NEW.`organization_id`, NEW.`booking_id`, NEW.`version`, NEW.`template_key`, NEW.`method`, NEW.`method_ref`, NEW.`sections_json`,
     NEW.`findings`, NEW.`conclusion`, NEW.`recommendations`, NEW.`number`, NEW.`status`, NEW.`updated_by`);
END;
