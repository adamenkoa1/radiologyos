ALTER TABLE `staff_tasks` ADD COLUMN `source` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `staff_tasks` ADD COLUMN `automation_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `staff_tasks` ADD COLUMN `source_entity_type` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `staff_tasks` ADD COLUMN `source_entity_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `staff_tasks_org_open_automation_idx`
  ON `staff_tasks` (`organization_id`, `automation_key`)
  WHERE `status` = 'open' AND `automation_key` <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `staff_tasks_org_source_idx`
  ON `staff_tasks` (`organization_id`, `source`, `source_entity_type`, `source_entity_id`);
