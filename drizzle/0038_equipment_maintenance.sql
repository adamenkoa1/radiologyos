-- Tenant-scoped equipment maintenance, faults and service history.
CREATE TABLE IF NOT EXISTS `equipment_maintenance` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization_id` integer NOT NULL,
  `equipment_id` text NOT NULL,
  `event_type` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `title` text NOT NULL,
  `details` text DEFAULT '' NOT NULL,
  `vendor` text DEFAULT '' NOT NULL,
  `assigned_email` text DEFAULT '' NOT NULL,
  `due_date` text DEFAULT '' NOT NULL,
  `downtime_start` text DEFAULT '' NOT NULL,
  `downtime_end` text DEFAULT '' NOT NULL,
  `created_by` text NOT NULL,
  `completed_by` text DEFAULT '' NOT NULL,
  `completed_at` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `equipment_maintenance_org_equipment_idx`
  ON `equipment_maintenance` (`organization_id`, `equipment_id`, `id` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `equipment_maintenance_org_status_idx`
  ON `equipment_maintenance` (`organization_id`, `status`, `due_date`, `id` DESC);
