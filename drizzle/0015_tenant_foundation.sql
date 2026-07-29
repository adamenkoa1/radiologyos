-- Tenant foundation (additive, non-destructive).
--
-- Крок 1-2 еволюційної мультитенантності: створюємо організаційні сутності і
-- початковий tenant. Крок 3-5: додаємо organization_id до бізнес-таблиць
-- (NOT NULL DEFAULT 1 — існуючі й нові рядки безпечно належать початковій
-- організації, доки код не почне передавати контекст явно), backfill через
-- DEFAULT, tenant-aware індекси. Жодних видалень колонок чи даних.

CREATE TABLE IF NOT EXISTS `organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizations_slug_idx` ON `organizations` (`slug`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_profiles` (
	`organization_id` integer PRIMARY KEY NOT NULL,
	`profile_type` text DEFAULT 'hospital_radiology' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`feature_flags_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `branches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `branches_org_idx` ON `branches` (`organization_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `departments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`branch_id` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `departments_org_idx` ON `departments` (`organization_id`, `branch_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`member_email` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `memberships_org_member_idx` ON `memberships` (`organization_id`, `member_email`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memberships_member_idx` ON `memberships` (`member_email`);
--> statement-breakpoint
-- Крок 2: початковий tenant — Чернігівський військовий госпіталь.
INSERT INTO `organizations` (`id`, `slug`, `name`)
	VALUES (1, 'chernihiv-military-hospital-radiology', 'Чернігівський військовий госпіталь');
--> statement-breakpoint
INSERT INTO `organization_profiles` (`organization_id`, `profile_type`)
	VALUES (1, 'hospital_radiology');
--> statement-breakpoint
INSERT INTO `branches` (`id`, `organization_id`, `name`)
	VALUES (1, 1, 'Чернігівський військовий госпіталь');
--> statement-breakpoint
INSERT INTO `departments` (`id`, `organization_id`, `branch_id`, `name`)
	VALUES (1, 1, 1, 'Відділення променевої діагностики');
--> statement-breakpoint
-- Наявний персонал стає учасниками початкової організації зі своєю роллю.
INSERT INTO `memberships` (`organization_id`, `member_email`, `role`, `active`)
	SELECT 1, `email`, `role`, `active` FROM `staff_members`;
--> statement-breakpoint
-- Крок 3-4: organization_id у бізнес-таблицях. NOT NULL DEFAULT 1 наповнює
-- існуючі рядки й підстраховує записи, що ще не передають контекст.
ALTER TABLE `bookings` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `booking_events` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `booking_staff_notes` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `imaging_studies` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `protocols` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `patient_profiles` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `patient_communications` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `patient_notifications` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_blocks` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `service_prices` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `report_exports` ADD COLUMN `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Крок 5: tenant-aware індекси для найгарячіших вибірок.
CREATE INDEX IF NOT EXISTS `bookings_org_schedule_idx` ON `bookings` (`organization_id`, `desired_date`, `desired_time`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `imaging_studies_org_idx` ON `imaging_studies` (`organization_id`, `study_status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `protocols_org_idx` ON `protocols` (`organization_id`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_communications_org_idx` ON `patient_communications` (`organization_id`, `phone_normalized`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_notifications_org_idx` ON `patient_notifications` (`organization_id`, `booking_id`);
