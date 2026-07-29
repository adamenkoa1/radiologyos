-- Security hardening: patient sessions, immutable protocol history,
-- idempotent booking requests, consent evidence and security audit records.

CREATE TABLE `patient_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `phone_normalized` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `patient_sessions_expiry_idx` ON `patient_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `booking_requests` (
  `idempotency_key` text PRIMARY KEY NOT NULL,
  `response_json` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD `consent_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `bookings` ADD `consent_version` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `bookings` ADD `consent_source` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `bookings` ADD `military_verified_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `bookings` ADD `military_verified_by` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `protocol_revisions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `booking_id` integer NOT NULL REFERENCES `bookings`(`id`) ON DELETE CASCADE,
  `version` integer NOT NULL,
  `template_key` text NOT NULL,
  `method` text DEFAULT '' NOT NULL,
  `sections_json` text DEFAULT '{}' NOT NULL,
  `findings` text DEFAULT '' NOT NULL,
  `conclusion` text DEFAULT '' NOT NULL,
  `recommendations` text DEFAULT '' NOT NULL,
  `number` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `saved_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE(`booking_id`, `version`)
);
--> statement-breakpoint
CREATE INDEX `protocol_revisions_booking_idx`
ON `protocol_revisions` (`booking_id`, `version`);
--> statement-breakpoint
CREATE TABLE `security_audit_log` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `actor_email` text NOT NULL,
  `action` text NOT NULL,
  `resource` text NOT NULL,
  `target_id` text DEFAULT '' NOT NULL,
  `details_json` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_audit_created_idx`
ON `security_audit_log` (`created_at`, `actor_email`);
--> statement-breakpoint
DELETE FROM `app_settings` WHERE `key` = 'registration_code_hash';
--> statement-breakpoint
DELETE FROM `app_settings` WHERE `key` = 'calendar_token';
--> statement-breakpoint
INSERT OR IGNORE INTO `app_settings` (`key`, `value`)
VALUES ('calendar_token_hash', '');
--> statement-breakpoint
DELETE FROM `staff_sessions`
WHERE `email` IN (
  SELECT `email` FROM `staff_members`
  WHERE `password_hash` = 'pbkdf2$sha256$100000$DIdGQmQdc8l2yyObk0lw0A==$btlwHhk42m8+m7NJlqXpZXQZYZ5d8gsRfxFMTqw59gc='
);
--> statement-breakpoint
UPDATE `staff_members`
SET `password_hash` = '', `active` = 0
WHERE `password_hash` = 'pbkdf2$sha256$100000$DIdGQmQdc8l2yyObk0lw0A==$btlwHhk42m8+m7NJlqXpZXQZYZ5d8gsRfxFMTqw59gc=';
