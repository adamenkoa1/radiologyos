CREATE TABLE IF NOT EXISTS `department_structure` (
  `organization_id` integer NOT NULL,
  `department_id` integer NOT NULL,
  `parent_department_id` integer,
  `unit_type` text DEFAULT 'unit' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`organization_id`, `department_id`),
  FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`parent_department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL,
  CHECK (`unit_type` IN ('department','subdivision','cabinet','unit','other')),
  CHECK (`parent_department_id` IS NULL OR `parent_department_id` <> `department_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `department_structure_org_parent_idx`
  ON `department_structure` (`organization_id`, `parent_department_id`, `unit_type`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `department_structure_scope_insert`
BEFORE INSERT ON `department_structure`
WHEN NOT EXISTS (
  SELECT 1 FROM `departments` child
  WHERE child.`id` = NEW.`department_id`
    AND child.`organization_id` = NEW.`organization_id`
) OR (
  NEW.`parent_department_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `departments` parent
    WHERE parent.`id` = NEW.`parent_department_id`
      AND parent.`organization_id` = NEW.`organization_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'department_structure_scope');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `department_structure_scope_update`
BEFORE UPDATE OF `organization_id`, `department_id`, `parent_department_id` ON `department_structure`
WHEN NOT EXISTS (
  SELECT 1 FROM `departments` child
  WHERE child.`id` = NEW.`department_id`
    AND child.`organization_id` = NEW.`organization_id`
) OR (
  NEW.`parent_department_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `departments` parent
    WHERE parent.`id` = NEW.`parent_department_id`
      AND parent.`organization_id` = NEW.`organization_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'department_structure_scope');
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `department_structure`
  (`organization_id`, `department_id`, `parent_department_id`, `unit_type`)
SELECT d.`organization_id`, d.`id`,
       CASE
         WHEN d.`name` IN ('Пересувний рентгенівський кабінет (ПРК)', 'Кабінет ультразвукової діагностики (УЗД)')
           THEN (
             SELECT parent.`id` FROM `departments` parent
             WHERE parent.`organization_id` = d.`organization_id`
               AND parent.`name` = 'Відділення променевої діагностики'
             ORDER BY parent.`id` LIMIT 1
           )
         ELSE NULL
       END,
       CASE
         WHEN d.`name` = 'Відділення променевої діагностики' THEN 'department'
         WHEN d.`name` LIKE '%ПРК%' OR d.`name` LIKE '%УЗД%' THEN 'subdivision'
         WHEN d.`name` LIKE '%кабінет%' OR d.`name` LIKE '%Кабінет%' THEN 'cabinet'
         ELSE 'unit'
       END
FROM `departments` d;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `personnel_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` integer NOT NULL,
  `personnel_id` text NOT NULL,
  `department_id` integer,
  `position_title` text NOT NULL,
  `assignment_kind` text DEFAULT 'primary' NOT NULL,
  `duties` text DEFAULT '' NOT NULL,
  `starts_on` text DEFAULT '' NOT NULL,
  `ends_on` text DEFAULT '' NOT NULL,
  `order_reference` text DEFAULT '' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`personnel_id`) REFERENCES `personnel_records`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT,
  CHECK (`assignment_kind` IN ('primary','acting','secondary','temporary','other')),
  CHECK (length(trim(`position_title`)) > 0),
  CHECK (`starts_on` = '' OR length(`starts_on`) = 10),
  CHECK (`ends_on` = '' OR length(`ends_on`) = 10),
  CHECK (`starts_on` = '' OR `ends_on` = '' OR `ends_on` >= `starts_on`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `personnel_assignments_org_person_idx`
  ON `personnel_assignments` (`organization_id`, `personnel_id`, `ends_on`, `starts_on`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `personnel_assignments_org_department_idx`
  ON `personnel_assignments` (`organization_id`, `department_id`, `ends_on`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `personnel_assignments_current_primary_idx`
  ON `personnel_assignments` (`organization_id`, `personnel_id`)
  WHERE `assignment_kind` = 'primary' AND `ends_on` = '';
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_assignments_scope_insert`
BEFORE INSERT ON `personnel_assignments`
WHEN NOT EXISTS (
  SELECT 1 FROM `personnel_records` p
  WHERE p.`id` = NEW.`personnel_id`
    AND p.`organization_id` = NEW.`organization_id`
) OR (
  NEW.`department_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `departments` d
    WHERE d.`id` = NEW.`department_id`
      AND d.`organization_id` = NEW.`organization_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_assignment_scope');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_assignments_scope_update`
BEFORE UPDATE OF `organization_id`, `personnel_id`, `department_id` ON `personnel_assignments`
WHEN NOT EXISTS (
  SELECT 1 FROM `personnel_records` p
  WHERE p.`id` = NEW.`personnel_id`
    AND p.`organization_id` = NEW.`organization_id`
) OR (
  NEW.`department_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `departments` d
    WHERE d.`id` = NEW.`department_id`
      AND d.`organization_id` = NEW.`organization_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_assignment_scope');
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `personnel_assignments`
  (`id`, `organization_id`, `personnel_id`, `department_id`, `position_title`,
   `assignment_kind`, `duties`, `starts_on`, `ends_on`, `order_reference`,
   `created_by`, `updated_by`)
SELECT 'assignment-backfill-' || p.`id`, p.`organization_id`, p.`id`, p.`department_id`,
       p.`position_title`, 'primary', '', substr(p.`created_at`, 1, 10), '', '',
       'migration-0115', 'migration-0115'
FROM `personnel_records` p
WHERE length(trim(p.`position_title`)) > 0;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `personnel_work_schedules` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` integer NOT NULL,
  `personnel_id` text NOT NULL,
  `name` text DEFAULT '' NOT NULL,
  `schedule_kind` text DEFAULT 'individual' NOT NULL,
  `valid_from` text NOT NULL,
  `valid_to` text DEFAULT '' NOT NULL,
  `weekly_minutes` integer DEFAULT 0 NOT NULL,
  `note` text DEFAULT '' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`personnel_id`) REFERENCES `personnel_records`(`id`) ON DELETE CASCADE,
  CHECK (`schedule_kind` IN ('five_day','six_day','shift','individual','other')),
  CHECK (length(`valid_from`) = 10),
  CHECK (`valid_to` = '' OR length(`valid_to`) = 10),
  CHECK (`valid_to` = '' OR `valid_to` >= `valid_from`),
  CHECK (`weekly_minutes` >= 0 AND `weekly_minutes` <= 10080),
  CHECK (`active` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `personnel_work_schedules_org_person_idx`
  ON `personnel_work_schedules` (`organization_id`, `personnel_id`, `active`, `valid_from`, `valid_to`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `personnel_work_schedules_current_idx`
  ON `personnel_work_schedules` (`organization_id`, `personnel_id`)
  WHERE `active` = 1 AND `valid_to` = '';
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_work_schedules_scope_insert`
BEFORE INSERT ON `personnel_work_schedules`
WHEN NOT EXISTS (
  SELECT 1 FROM `personnel_records` p
  WHERE p.`id` = NEW.`personnel_id`
    AND p.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_work_schedule_scope');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_work_schedules_scope_update`
BEFORE UPDATE OF `organization_id`, `personnel_id` ON `personnel_work_schedules`
WHEN NOT EXISTS (
  SELECT 1 FROM `personnel_records` p
  WHERE p.`id` = NEW.`personnel_id`
    AND p.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_work_schedule_scope');
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personnel_work_schedule_days` (
  `schedule_id` text NOT NULL,
  `organization_id` integer NOT NULL,
  `weekday` integer NOT NULL,
  `is_working` integer DEFAULT 0 NOT NULL,
  `start_time` text DEFAULT '' NOT NULL,
  `end_time` text DEFAULT '' NOT NULL,
  `break_start` text DEFAULT '' NOT NULL,
  `break_end` text DEFAULT '' NOT NULL,
  PRIMARY KEY (`schedule_id`, `weekday`),
  FOREIGN KEY (`schedule_id`) REFERENCES `personnel_work_schedules`(`id`) ON DELETE CASCADE,
  CHECK (`weekday` BETWEEN 1 AND 7),
  CHECK (`is_working` IN (0,1)),
  CHECK (`start_time` = '' OR length(`start_time`) = 5),
  CHECK (`end_time` = '' OR length(`end_time`) = 5),
  CHECK (`break_start` = '' OR length(`break_start`) = 5),
  CHECK (`break_end` = '' OR length(`break_end`) = 5),
  CHECK (`is_working` = 0 OR (`start_time` <> '' AND `end_time` <> '')),
  CHECK (`is_working` = 1 OR (`start_time` = '' AND `end_time` = '' AND `break_start` = '' AND `break_end` = ''))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `personnel_work_schedule_days_org_idx`
  ON `personnel_work_schedule_days` (`organization_id`, `schedule_id`, `weekday`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_work_schedule_days_scope_insert`
BEFORE INSERT ON `personnel_work_schedule_days`
WHEN NOT EXISTS (
  SELECT 1 FROM `personnel_work_schedules` s
  WHERE s.`id` = NEW.`schedule_id`
    AND s.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_work_schedule_day_scope');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_work_schedule_days_scope_update`
BEFORE UPDATE OF `schedule_id`, `organization_id` ON `personnel_work_schedule_days`
WHEN NOT EXISTS (
  SELECT 1 FROM `personnel_work_schedules` s
  WHERE s.`id` = NEW.`schedule_id`
    AND s.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_work_schedule_day_scope');
END;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `personnel_shift_assignments` (
  `organization_id` integer NOT NULL,
  `personnel_id` text NOT NULL,
  `preset_code` text NOT NULL,
  `team_index` integer NOT NULL,
  `anchor_date` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`organization_id`, `personnel_id`),
  FOREIGN KEY (`personnel_id`) REFERENCES `personnel_records`(`id`) ON DELETE CASCADE,
  CHECK (`team_index` >= 1),
  CHECK (length(`anchor_date`) = 10)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `personnel_shift_assignments_org_idx`
  ON `personnel_shift_assignments` (`organization_id`, `preset_code`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_shift_assignments_scope_insert`
BEFORE INSERT ON `personnel_shift_assignments`
WHEN NOT EXISTS (
  SELECT 1 FROM `personnel_records` p
  WHERE p.`id` = NEW.`personnel_id`
    AND p.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_shift_assignment_scope');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_shift_assignments_scope_update`
BEFORE UPDATE OF `organization_id`, `personnel_id` ON `personnel_shift_assignments`
WHEN NOT EXISTS (
  SELECT 1 FROM `personnel_records` p
  WHERE p.`id` = NEW.`personnel_id`
    AND p.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_shift_assignment_scope');
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `personnel_shift_assignments`
  (`organization_id`, `personnel_id`, `preset_code`, `team_index`, `anchor_date`,
   `created_by`, `created_at`, `updated_by`, `updated_at`)
SELECT old.`organization_id`, p.`id`, old.`preset_code`, old.`team_index`, old.`anchor_date`,
       old.`created_by`, old.`created_at`, old.`updated_by`, old.`updated_at`
FROM `staff_shift_assignments` old
JOIN `personnel_records` p
  ON p.`organization_id` = old.`organization_id`
 AND p.`account_email` = old.`staff_email`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personnel_shift_overrides` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `personnel_id` text NOT NULL,
  `shift_date` text NOT NULL,
  `kind` text NOT NULL,
  `label` text DEFAULT '' NOT NULL,
  `start_time` text DEFAULT '' NOT NULL,
  `end_time` text DEFAULT '' NOT NULL,
  `note` text DEFAULT '' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`personnel_id`) REFERENCES `personnel_records`(`id`) ON DELETE CASCADE,
  UNIQUE (`organization_id`, `personnel_id`, `shift_date`),
  CHECK (`kind` IN ('day','evening','night','duty','work','off','recovery','leave','sick','custom')),
  CHECK (length(`shift_date`) = 10)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `personnel_shift_overrides_org_date_idx`
  ON `personnel_shift_overrides` (`organization_id`, `shift_date`, `personnel_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_shift_overrides_scope_insert`
BEFORE INSERT ON `personnel_shift_overrides`
WHEN NOT EXISTS (
  SELECT 1 FROM `personnel_records` p
  WHERE p.`id` = NEW.`personnel_id`
    AND p.`organization_id` = NEW.`organization_id`
) OR NOT EXISTS (
  SELECT 1 FROM `personnel_shift_assignments` a
  WHERE a.`organization_id` = NEW.`organization_id`
    AND a.`personnel_id` = NEW.`personnel_id`
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_shift_override_scope');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personnel_shift_overrides_scope_update`
BEFORE UPDATE OF `organization_id`, `personnel_id` ON `personnel_shift_overrides`
WHEN NOT EXISTS (
  SELECT 1 FROM `personnel_records` p
  WHERE p.`id` = NEW.`personnel_id`
    AND p.`organization_id` = NEW.`organization_id`
) OR NOT EXISTS (
  SELECT 1 FROM `personnel_shift_assignments` a
  WHERE a.`organization_id` = NEW.`organization_id`
    AND a.`personnel_id` = NEW.`personnel_id`
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_shift_override_scope');
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `personnel_shift_overrides`
  (`organization_id`, `personnel_id`, `shift_date`, `kind`, `label`, `start_time`, `end_time`, `note`,
   `created_by`, `created_at`, `updated_by`, `updated_at`)
SELECT old.`organization_id`, p.`id`, old.`shift_date`, old.`kind`, old.`label`, old.`start_time`, old.`end_time`, old.`note`,
       old.`created_by`, old.`created_at`, old.`updated_by`, old.`updated_at`
FROM `staff_shift_overrides` old
JOIN `personnel_records` p
  ON p.`organization_id` = old.`organization_id`
 AND p.`account_email` = old.`staff_email`;
