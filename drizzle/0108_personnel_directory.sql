CREATE TABLE IF NOT EXISTS `personnel_records` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` integer NOT NULL,
  `account_email` text,
  `staff_number` text DEFAULT '' NOT NULL,
  `employment_kind` text DEFAULT 'unspecified' NOT NULL,
  `last_name` text DEFAULT '' NOT NULL,
  `first_name` text DEFAULT '' NOT NULL,
  `patronymic` text DEFAULT '' NOT NULL,
  `display_name` text DEFAULT '' NOT NULL,
  `date_of_birth` text DEFAULT '' NOT NULL,
  `military_rank` text DEFAULT '' NOT NULL,
  `position_title` text DEFAULT '' NOT NULL,
  `department_id` integer,
  `work_phone` text DEFAULT '' NOT NULL,
  `personal_phone` text DEFAULT '' NOT NULL,
  `work_email` text DEFAULT '' NOT NULL,
  `alternate_email` text DEFAULT '' NOT NULL,
  `region` text DEFAULT '' NOT NULL,
  `city` text DEFAULT '' NOT NULL,
  `address_line` text DEFAULT '' NOT NULL,
  `postal_code` text DEFAULT '' NOT NULL,
  `photo_storage_key` text DEFAULT '' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (`employment_kind` IN ('unspecified','military','civilian','contractor','other')),
  CHECK (`active` IN (0,1)),
  CHECK (`date_of_birth` = '' OR length(`date_of_birth`) = 10)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `personnel_records_org_name_idx`
  ON `personnel_records` (`organization_id`, `active`, `last_name`, `first_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `personnel_records_org_department_idx`
  ON `personnel_records` (`organization_id`, `department_id`, `active`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `personnel_records_org_account_idx`
  ON `personnel_records` (`organization_id`, `account_email`)
  WHERE `account_email` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_records_department_scope_insert`
BEFORE INSERT ON `personnel_records`
WHEN NEW.`department_id` IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM `departments` d
   WHERE d.`id` = NEW.`department_id`
     AND d.`organization_id` = NEW.`organization_id`
 )
BEGIN
  SELECT RAISE(ABORT, 'personnel_department_scope');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_records_department_scope_update`
BEFORE UPDATE OF `department_id`, `organization_id` ON `personnel_records`
WHEN NEW.`department_id` IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM `departments` d
   WHERE d.`id` = NEW.`department_id`
     AND d.`organization_id` = NEW.`organization_id`
 )
BEGIN
  SELECT RAISE(ABORT, 'personnel_department_scope');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_records_account_scope_insert`
BEFORE INSERT ON `personnel_records`
WHEN NEW.`account_email` IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM `memberships` m
   WHERE m.`organization_id` = NEW.`organization_id`
     AND m.`member_email` = NEW.`account_email`
 )
BEGIN
  SELECT RAISE(ABORT, 'personnel_account_scope');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_records_account_scope_update`
BEFORE UPDATE OF `account_email`, `organization_id` ON `personnel_records`
WHEN NEW.`account_email` IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM `memberships` m
   WHERE m.`organization_id` = NEW.`organization_id`
     AND m.`member_email` = NEW.`account_email`
 )
BEGIN
  SELECT RAISE(ABORT, 'personnel_account_scope');
END;
--> statement-breakpoint
INSERT INTO `departments` (`organization_id`, `branch_id`, `name`, `active`)
SELECT 1,
       COALESCE((SELECT b.`id` FROM `branches` b WHERE b.`organization_id` = 1 ORDER BY b.`id` LIMIT 1), 0),
       'Пересувний рентгенівський кабінет (ПРК)',
       1
WHERE EXISTS (SELECT 1 FROM `organizations` WHERE `id` = 1)
  AND NOT EXISTS (
    SELECT 1 FROM `departments`
    WHERE `organization_id` = 1 AND `name` = 'Пересувний рентгенівський кабінет (ПРК)'
  );
--> statement-breakpoint
INSERT INTO `departments` (`organization_id`, `branch_id`, `name`, `active`)
SELECT 1,
       COALESCE((SELECT b.`id` FROM `branches` b WHERE b.`organization_id` = 1 ORDER BY b.`id` LIMIT 1), 0),
       'Кабінет ультразвукової діагностики (УЗД)',
       1
WHERE EXISTS (SELECT 1 FROM `organizations` WHERE `id` = 1)
  AND NOT EXISTS (
    SELECT 1 FROM `departments`
    WHERE `organization_id` = 1 AND `name` = 'Кабінет ультразвукової діагностики (УЗД)'
  );
--> statement-breakpoint
INSERT INTO `personnel_records` (
  `id`, `organization_id`, `account_email`,
  `last_name`, `first_name`, `patronymic`, `display_name`,
  `military_rank`, `position_title`, `department_id`,
  `work_phone`, `work_email`, `active`, `created_by`, `updated_by`
)
SELECT
  'personnel-' || m.`organization_id` || '-' || m.`id`,
  m.`organization_id`,
  m.`member_email`,
  COALESCE(s.`last_name`, ''),
  COALESCE(s.`first_name`, ''),
  COALESCE(s.`patronymic`, ''),
  COALESCE(NULLIF(s.`display_name`, ''), trim(COALESCE(s.`last_name`, '') || ' ' || COALESCE(s.`first_name`, '') || ' ' || COALESCE(s.`patronymic`, ''))),
  COALESCE(s.`military_rank`, ''),
  COALESCE(s.`position_title`, ''),
  (SELECT d.`id` FROM `departments` d
   WHERE d.`organization_id` = m.`organization_id`
     AND d.`name` = 'Відділення променевої діагностики'
   ORDER BY d.`id` LIMIT 1),
  COALESCE(s.`phone`, ''),
  COALESCE(s.`contact_email`, ''),
  m.`active`,
  'migration-0108',
  'migration-0108'
FROM `memberships` m
JOIN `staff_members` s ON s.`email` = m.`member_email`
WHERE NOT EXISTS (
  SELECT 1 FROM `personnel_records` p
  WHERE p.`organization_id` = m.`organization_id`
    AND p.`account_email` = m.`member_email`
);