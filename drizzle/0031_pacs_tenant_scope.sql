ALTER TABLE `pacs_settings` ADD COLUMN `organization_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pacs_settings_organization_idx`
ON `pacs_settings` (`organization_id`);
--> statement-breakpoint
UPDATE `pacs_settings` SET `organization_id` = 1 WHERE `organization_id` IS NULL OR `organization_id` = 0;
