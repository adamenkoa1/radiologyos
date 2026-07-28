-- Private iCal (ICS) subscription token for the Google Calendar feed of
-- appointments. Empty means the feed is disabled until an admin generates a link.

INSERT OR IGNORE INTO `app_settings` (`key`, `value`) VALUES ('calendar_token', '');
