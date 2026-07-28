-- Department-configurable settings (managed by an admin in /staff/settings):
-- Telegram notifications for new bookings and the PrivatBank payment link for
-- civilian patients. Empty values mean the feature is simply off.

INSERT OR IGNORE INTO `app_settings` (`key`, `value`) VALUES
  ('telegram_bot_token', ''),
  ('telegram_chat_id', ''),
  ('pay_link', '');
