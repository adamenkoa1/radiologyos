CREATE TABLE `saved_report_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`report_key` text DEFAULT 'register_turnover' NOT NULL,
	`name` text NOT NULL,
	`configuration_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "saved_report_views_report_key_check" CHECK(`report_key` = 'register_turnover'),
	CONSTRAINT "saved_report_views_name_check" CHECK(length(trim(`name`)) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_report_views_org_report_name_unique` ON `saved_report_views` (`organization_id`,`report_key`,`name`);--> statement-breakpoint
CREATE INDEX `saved_report_views_org_report_idx` ON `saved_report_views` (`organization_id`,`report_key`,`updated_at`,`id`);