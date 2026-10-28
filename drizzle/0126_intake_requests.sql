CREATE TABLE `intake_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`channel` text DEFAULT 'telegram' NOT NULL,
	`external_ref` text DEFAULT '' NOT NULL,
	`external_update_id` text DEFAULT '' NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`desired_service` text DEFAULT '' NOT NULL,
	`desired_time` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`assigned_email` text DEFAULT '' NOT NULL,
	`linked_booking_id` integer DEFAULT 0 NOT NULL,
	`linked_patient_id` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "intake_requests_status_check" CHECK(`status` IN ('new','in_progress','converted','declined'))
);
--> statement-breakpoint
CREATE INDEX `intake_requests_org_status_idx` ON `intake_requests` (`organization_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `intake_requests_dedup_idx` ON `intake_requests` (`organization_id`,`channel`,`external_update_id`);