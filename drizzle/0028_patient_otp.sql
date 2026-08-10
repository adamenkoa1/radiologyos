-- Possession-based patient authentication.
-- OTP values are never stored in plaintext: `code_hash` uses the same salted
-- PBKDF2-HMAC-SHA256 primitive as staff PINs. Challenges are short-lived,
-- single-use and explicitly scoped to an organization + normalized phone.

ALTER TABLE `patient_sessions` ADD `organization_id` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE INDEX `patient_sessions_org_phone_idx`
ON `patient_sessions` (`organization_id`, `phone_normalized`, `expires_at`);
--> statement-breakpoint

CREATE TABLE `patient_otp_challenges` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` integer DEFAULT 1 NOT NULL,
  `phone_normalized` text NOT NULL,
  `purpose` text DEFAULT 'cabinet_login' NOT NULL,
  `code_hash` text NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `expires_at` text NOT NULL,
  `consumed_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `patient_otp_phone_idx`
ON `patient_otp_challenges` (`organization_id`, `phone_normalized`, `created_at`);
--> statement-breakpoint
CREATE INDEX `patient_otp_expiry_idx`
ON `patient_otp_challenges` (`expires_at`, `consumed_at`);
