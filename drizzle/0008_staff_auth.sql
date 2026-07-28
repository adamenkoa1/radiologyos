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
--> statement-breakpoint
UPDATE `staff_members`
SET `password_hash` = 'pbkdf2$sha256$100000$DIdGQmQdc8l2yyObk0lw0A==$btlwHhk42m8+m7NJlqXpZXQZYZ5d8gsRfxFMTqw59gc='
WHERE `email` = 'adamenko.artem96@gmail.com';
