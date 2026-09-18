CREATE TABLE `analytics_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL DEFAULT 1,
  `event_name` text NOT NULL,
  `journey_id` text NOT NULL DEFAULT '',
  `service_code` text NOT NULL DEFAULT '',
  `patient_category` text NOT NULL DEFAULT '',
  `page_key` text NOT NULL DEFAULT '',
  `source` text NOT NULL DEFAULT 'server',
  `occurred_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (`event_name` IN ('page_view','service_view','booking_started','slot_selected','booking_created','payment_started','payment_completed','patient_arrived','study_completed')),
  CHECK (`patient_category` IN ('','civilian','military')),
  CHECK (`source` IN ('client','server')),
  CHECK (length(`journey_id`) <= 64),
  CHECK (length(`service_code`) <= 16),
  CHECK (length(`page_key`) <= 64)
);
--> statement-breakpoint
CREATE INDEX `analytics_events_org_time_idx` ON `analytics_events` (`organization_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `analytics_events_org_event_time_idx` ON `analytics_events` (`organization_id`,`event_name`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `analytics_events_journey_idx` ON `analytics_events` (`organization_id`,`journey_id`,`occurred_at`);
