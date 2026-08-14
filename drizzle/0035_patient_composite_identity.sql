-- Patient identity is tenant-local: the same normalized phone may belong to
-- independent patient profiles in different organizations.
CREATE TABLE `patient_profiles_v2` (
  `organization_id` integer NOT NULL DEFAULT 1,
  `phone_normalized` text NOT NULL,
  `display_name` text NOT NULL DEFAULT '',
  `birth_year` integer NOT NULL DEFAULT 0,
  `birth_date` text NOT NULL DEFAULT '',
  `email` text NOT NULL DEFAULT '',
  `address` text NOT NULL DEFAULT '',
  `tags` text NOT NULL DEFAULT '',
  `notes` text NOT NULL DEFAULT '',
  `do_not_contact` integer NOT NULL DEFAULT 0,
  `telegram_chat_id` text NOT NULL DEFAULT '',
  `updated_by` text NOT NULL,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`organization_id`, `phone_normalized`)
);
--> statement-breakpoint
INSERT INTO `patient_profiles_v2` (
  `organization_id`, `phone_normalized`, `display_name`, `birth_year`, `birth_date`,
  `email`, `address`, `tags`, `notes`, `do_not_contact`, `telegram_chat_id`,
  `updated_by`, `updated_at`
)
SELECT
  `organization_id`, `phone_normalized`, `display_name`, `birth_year`, `birth_date`,
  `email`, `address`, `tags`, `notes`, `do_not_contact`, `telegram_chat_id`,
  `updated_by`, `updated_at`
FROM `patient_profiles`;
--> statement-breakpoint
DROP TABLE `patient_profiles`;
--> statement-breakpoint
ALTER TABLE `patient_profiles_v2` RENAME TO `patient_profiles`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_profiles_phone_idx`
ON `patient_profiles` (`phone_normalized`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_profiles_org_updated_idx`
ON `patient_profiles` (`organization_id`, `updated_at`);
--> statement-breakpoint
-- Telegram deep-link tokens must carry the tenant so consuming a token cannot
-- attach a chat to another organization's profile with the same phone.
ALTER TABLE `telegram_link_tokens` ADD COLUMN `organization_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `telegram_link_tokens_org_phone_idx`
ON `telegram_link_tokens` (`organization_id`, `phone_normalized`);
