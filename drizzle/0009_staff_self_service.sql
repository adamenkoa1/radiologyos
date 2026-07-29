-- Staff settings and a disabled administrator placeholder. Production
-- credentials are provisioned out-of-band and never committed to Git.

CREATE TABLE IF NOT EXISTS `app_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
INSERT OR IGNORE INTO `staff_members` (`email`, `display_name`, `role`, `active`, `password_hash`)
VALUES ('adamenko.artem96@gmail.com', 'Адміністратор RadiologyOS', 'admin', 0, '');
