CREATE TABLE `protocol_user_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`owner_email` text NOT NULL,
	`title` text NOT NULL,
	`base_template_key` text NOT NULL,
	`document_json` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "protocol_user_templates_check_1" CHECK(`length`(`trim`(`owner_email`)) > 0),
	CONSTRAINT "protocol_user_templates_check_2" CHECK(`length`(`trim`(`title`)) BETWEEN 1 AND 120),
	CONSTRAINT "protocol_user_templates_check_3" CHECK(`length`(`trim`(`base_template_key`)) > 0),
	CONSTRAINT "protocol_user_templates_check_4" CHECK(`length`(`document_json`) BETWEEN 2 AND 40000)
);
--> statement-breakpoint
CREATE INDEX `protocol_user_templates_owner_idx` ON `protocol_user_templates` (`organization_id`,`owner_email`,`title`);