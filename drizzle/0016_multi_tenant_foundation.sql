-- Multi-tenant foundation. This migration is additive: existing hospital data
-- is assigned to the initial radiology organization before new tenants arrive.

CREATE TABLE `organizations` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL UNIQUE,
  `name` text NOT NULL,
  `profile` text DEFAULT 'hospital_radiology' NOT NULL,
  `locale` text DEFAULT 'uk-UA' NOT NULL,
  `timezone` text DEFAULT 'Europe/Kyiv' NOT NULL,
  `currency` text DEFAULT 'UAH' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `organization_branches` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `address` text DEFAULT '' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organization_branches_org_idx`
ON `organization_branches` (`organization_id`, `active`);
--> statement-breakpoint
CREATE TABLE `organization_departments` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `branch_id` text NOT NULL REFERENCES `organization_branches`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `profile` text DEFAULT 'hospital_radiology' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organization_departments_org_idx`
ON `organization_departments` (`organization_id`, `branch_id`, `active`);
--> statement-breakpoint
CREATE TABLE `organization_memberships` (
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `staff_email` text NOT NULL REFERENCES `staff_members`(`email`) ON DELETE CASCADE,
  `department_id` text DEFAULT '' NOT NULL,
  `role` text NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`organization_id`, `staff_email`)
);
--> statement-breakpoint
CREATE INDEX `organization_memberships_staff_idx`
ON `organization_memberships` (`staff_email`, `active`);
--> statement-breakpoint
CREATE TABLE `organization_settings` (
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `key` text NOT NULL,
  `value` text DEFAULT '' NOT NULL,
  PRIMARY KEY (`organization_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `organization_service_prices` (
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `code` text NOT NULL,
  `price` integer NOT NULL,
  PRIMARY KEY (`organization_id`, `code`)
);
--> statement-breakpoint
CREATE TABLE `organization_patient_profiles` (
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `phone_normalized` text NOT NULL,
  `display_name` text DEFAULT '' NOT NULL,
  `birth_year` integer DEFAULT 0 NOT NULL,
  `tags` text DEFAULT '' NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `do_not_contact` integer DEFAULT 0 NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`organization_id`, `phone_normalized`)
);
--> statement-breakpoint
CREATE TABLE `organization_pacs_settings` (
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `dicomweb_base_url` text DEFAULT '' NOT NULL,
  `viewer_base_url` text DEFAULT '' NOT NULL,
  `ae_title` text DEFAULT '' NOT NULL,
  `enabled` integer DEFAULT 0 NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `updated_by` text DEFAULT '' NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`organization_id`)
);
--> statement-breakpoint
INSERT INTO `organizations`
  (`id`, `slug`, `name`, `profile`, `locale`, `timezone`, `currency`)
VALUES
  ('chernihiv-military-hospital-radiology',
   'chernihiv-military-hospital-radiology',
   'Чернігівський військовий госпіталь',
   'hospital_radiology', 'uk-UA', 'Europe/Kyiv', 'UAH');
--> statement-breakpoint
INSERT INTO `organization_branches`
  (`id`, `organization_id`, `name`)
VALUES
  ('chernihiv-military-hospital-main',
   'chernihiv-military-hospital-radiology',
   'Чернігівський військовий госпіталь');
--> statement-breakpoint
INSERT INTO `organization_departments`
  (`id`, `organization_id`, `branch_id`, `name`, `profile`)
VALUES
  ('chernihiv-military-hospital-radiology-department',
   'chernihiv-military-hospital-radiology',
   'chernihiv-military-hospital-main',
   'Відділення променевої діагностики',
   'hospital_radiology');
--> statement-breakpoint
INSERT INTO `organization_memberships`
  (`organization_id`, `staff_email`, `department_id`, `role`, `active`)
SELECT
  'chernihiv-military-hospital-radiology',
  `email`,
  'chernihiv-military-hospital-radiology-department',
  `role`,
  `active`
FROM `staff_members`;
--> statement-breakpoint
INSERT INTO `organization_settings` (`organization_id`, `key`, `value`)
SELECT 'chernihiv-military-hospital-radiology', `key`, `value`
FROM `app_settings`;
--> statement-breakpoint
INSERT INTO `organization_service_prices` (`organization_id`, `code`, `price`)
SELECT 'chernihiv-military-hospital-radiology', `code`, `price`
FROM `service_prices`;
--> statement-breakpoint
INSERT INTO `organization_patient_profiles`
  (`organization_id`, `phone_normalized`, `display_name`, `birth_year`, `tags`,
   `notes`, `do_not_contact`, `updated_by`, `updated_at`)
SELECT
  'chernihiv-military-hospital-radiology', `phone_normalized`, `display_name`,
  `birth_year`, `tags`, `notes`, `do_not_contact`, `updated_by`, `updated_at`
FROM `patient_profiles`;
--> statement-breakpoint
INSERT INTO `organization_pacs_settings`
  (`organization_id`, `dicomweb_base_url`, `viewer_base_url`, `ae_title`,
   `enabled`, `notes`, `updated_by`, `updated_at`)
SELECT
  'chernihiv-military-hospital-radiology', `dicomweb_base_url`,
  `viewer_base_url`, `ae_title`, `enabled`, `notes`, `updated_by`, `updated_at`
FROM `pacs_settings`;
--> statement-breakpoint
ALTER TABLE `bookings`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `booking_events`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `booking_staff_notes`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `staff_sessions`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `staff_sessions`
ADD `department_id` text DEFAULT 'chernihiv-military-hospital-radiology-department' NOT NULL;
--> statement-breakpoint
ALTER TABLE `patient_sessions`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `booking_requests`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_blocks`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `protocols`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `protocol_revisions`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `patient_profiles`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `patient_communications`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `patient_notifications`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `imaging_studies`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `pacs_settings`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `report_exports`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
ALTER TABLE `security_audit_log`
ADD `organization_id` text DEFAULT 'chernihiv-military-hospital-radiology' NOT NULL;
--> statement-breakpoint
CREATE INDEX `bookings_org_schedule_idx`
ON `bookings` (`organization_id`, `equipment_id`, `desired_date`, `desired_time`);
--> statement-breakpoint
CREATE INDEX `bookings_org_patient_idx`
ON `bookings` (`organization_id`, `phone_normalized`, `desired_date`);
--> statement-breakpoint
CREATE INDEX `booking_events_org_booking_idx`
ON `booking_events` (`organization_id`, `booking_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `equipment_blocks_org_schedule_idx`
ON `equipment_blocks` (`organization_id`, `equipment_id`, `blocked_date`, `start_time`);
--> statement-breakpoint
CREATE INDEX `patient_profiles_org_phone_idx`
ON `patient_profiles` (`organization_id`, `phone_normalized`);
--> statement-breakpoint
CREATE INDEX `patient_communications_org_phone_idx`
ON `patient_communications` (`organization_id`, `phone_normalized`, `created_at`);
--> statement-breakpoint
CREATE INDEX `protocol_revisions_org_booking_idx`
ON `protocol_revisions` (`organization_id`, `booking_id`, `version`);
--> statement-breakpoint
CREATE INDEX `report_exports_org_created_idx`
ON `report_exports` (`organization_id`, `created_at`, `requested_by`);
--> statement-breakpoint
CREATE INDEX `security_audit_org_created_idx`
ON `security_audit_log` (`organization_id`, `created_at`, `actor_email`);
