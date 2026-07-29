ALTER TABLE `staff_members` ADD COLUMN `password_hash` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `staff_sessions_expiry_idx`
ON `staff_sessions` (`expires_at`);
