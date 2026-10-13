CREATE TABLE `protocol_macros` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`owner_email` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "protocol_macros_check_1" CHECK(`length`(`trim`(`owner_email`)) > 0),
	CONSTRAINT "protocol_macros_check_2" CHECK(`length`(`trim`(`title`)) BETWEEN 1 AND 120),
	CONSTRAINT "protocol_macros_check_3" CHECK(`length`(`trim`(`body`)) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE INDEX `protocol_macros_owner_idx` ON `protocol_macros` (`organization_id`,`owner_email`,`title`);