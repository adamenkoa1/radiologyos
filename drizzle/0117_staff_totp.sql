ALTER TABLE `staff_members` ADD `totp_secret` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_members` ADD `totp_enabled` integer DEFAULT 0 NOT NULL;