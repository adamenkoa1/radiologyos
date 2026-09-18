-- Telegram-канал до пацієнта: зберігаємо chat_id у профілі та короткоживучі
-- токени для deep-link прив'язки (пацієнт натискає «Старт» у боті один раз).
ALTER TABLE `patient_profiles` ADD COLUMN `telegram_chat_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `telegram_link_tokens` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `phone_normalized` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` text NOT NULL
);
