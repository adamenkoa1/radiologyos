-- Self-service staff onboarding: department access code (for registration and
-- password reset) plus an idempotent re-assert of the seed administrator so the
-- account can always sign in on a freshly migrated database.

CREATE TABLE IF NOT EXISTS `app_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
-- Default department access code: RADIOLOGY-2026 (stored only as a PBKDF2 hash).
-- Share it with staff so they can register or reset their password themselves.
INSERT OR IGNORE INTO `app_settings` (`key`, `value`) VALUES
  ('registration_code_hash', 'pbkdf2$sha256$100000$ip3KSha+LgxDS0d4QcCSXA==$7XHl90cQVhcziLxKPiaBHDDvJmkrWJ4i269IZqEhS0g=');
--> statement-breakpoint
-- Make sure the administrator row exists (no-op if it already does).
INSERT OR IGNORE INTO `staff_members` (`email`, `display_name`, `role`, `active`)
VALUES ('adamenko.artem96@gmail.com', 'Адміністратор RadiologyOS', 'admin', 1);
--> statement-breakpoint
-- Re-assert the administrator password (RadiologyOS!2026) only when it is unset,
-- so a database where migration 0008 did not land the hash can still sign in
-- while any password the admin has since chosen is preserved.
UPDATE `staff_members`
SET `password_hash` = 'pbkdf2$sha256$100000$DIdGQmQdc8l2yyObk0lw0A==$btlwHhk42m8+m7NJlqXpZXQZYZ5d8gsRfxFMTqw59gc='
WHERE `email` = 'adamenko.artem96@gmail.com' AND (`password_hash` IS NULL OR `password_hash` = '');
