CREATE TABLE `critical_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`booking_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`flagged_by` text NOT NULL,
	`flagged_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`communicated_by` text DEFAULT '' NOT NULL,
	`communicated_at` text DEFAULT '' NOT NULL,
	`communicated_via` text DEFAULT '' NOT NULL,
	`resolved_by` text DEFAULT '' NOT NULL,
	`resolved_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `critical_findings_booking_unique` ON `critical_findings` (`organization_id`,`booking_id`);--> statement-breakpoint
CREATE INDEX `critical_findings_org_status_idx` ON `critical_findings` (`organization_id`,`status`,`flagged_at`);