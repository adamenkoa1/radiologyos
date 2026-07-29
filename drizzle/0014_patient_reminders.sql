-- Автонагадування пацієнту після підтвердження / перенесення запису.
-- Додає адресу e-mail пацієнта (для e-mail каналу; SMS іде на телефон),
-- журнал відправлень (outbox) і налаштування шлюзів SMS / e-mail.

ALTER TABLE `bookings` ADD `patient_email` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `patient_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`booking_id` integer NOT NULL,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`recipient` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `patient_notifications_booking_idx` ON `patient_notifications` (`booking_id`,`created_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `app_settings` (`key`, `value`) VALUES ('patient_reminders_enabled', '');
--> statement-breakpoint
INSERT OR IGNORE INTO `app_settings` (`key`, `value`) VALUES ('sms_gateway_url', '');
--> statement-breakpoint
INSERT OR IGNORE INTO `app_settings` (`key`, `value`) VALUES ('sms_gateway_auth', '');
--> statement-breakpoint
INSERT OR IGNORE INTO `app_settings` (`key`, `value`) VALUES ('email_gateway_url', '');
--> statement-breakpoint
INSERT OR IGNORE INTO `app_settings` (`key`, `value`) VALUES ('email_gateway_auth', '');
--> statement-breakpoint
INSERT OR IGNORE INTO `app_settings` (`key`, `value`) VALUES ('email_gateway_from', '');
