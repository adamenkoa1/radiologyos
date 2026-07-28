-- Editable tariffs: per-service price overrides managed by an admin in the
-- "Тарифи" tab. A missing row means the default catalog price applies.

CREATE TABLE IF NOT EXISTS `service_prices` (
  `code` text PRIMARY KEY NOT NULL,
  `price` integer NOT NULL
);
