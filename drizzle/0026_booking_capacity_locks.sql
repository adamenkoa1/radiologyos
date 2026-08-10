-- Atomic equipment capacity reservation.
--
-- Each occupied minute of an appointment receives one unique row. SQLite/D1
-- uniqueness therefore becomes the final concurrency guard: two different
-- requests cannot reserve overlapping time on the same equipment/date even if
-- both calculated availability from the same stale snapshot.
--
-- booking_code is used instead of booking_id because public booking codes are
-- allocated before the booking INSERT and can therefore participate in the
-- same D1 batch. Locks are removed explicitly when a booking is cancelled,
-- completed or moved.

CREATE TABLE `booking_capacity_locks` (
  `organization_id` integer DEFAULT 1 NOT NULL,
  `equipment_id` text NOT NULL,
  `booking_date` text NOT NULL,
  `minute` text NOT NULL,
  `booking_code` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`organization_id`, `equipment_id`, `booking_date`, `minute`)
);
--> statement-breakpoint
CREATE INDEX `booking_capacity_locks_booking_idx`
ON `booking_capacity_locks` (`organization_id`, `booking_code`);
--> statement-breakpoint

-- Backfill capacity for active appointments that already exist when this
-- migration is applied. Recursive CTE expands every booking into [start,end)
-- minute keys. INSERT OR IGNORE makes deployment safe if historical data
-- already contains an overlap: current rows are preserved and the production
-- gate can surface the conflicting booking for manual resolution.
WITH RECURSIVE active AS (
  SELECT organization_id, equipment_id, desired_date, code,
         CAST(substr(desired_time, 1, 2) AS integer) * 60
           + CAST(substr(desired_time, 4, 2) AS integer) AS start_minute,
         duration_minutes
  FROM bookings
  WHERE status IN ('new', 'confirmed', 'rescheduled')
), expanded(organization_id, equipment_id, desired_date, code, minute_no, end_minute) AS (
  SELECT organization_id, equipment_id, desired_date, code,
         start_minute, start_minute + duration_minutes
  FROM active
  UNION ALL
  SELECT organization_id, equipment_id, desired_date, code,
         minute_no + 1, end_minute
  FROM expanded
  WHERE minute_no + 1 < end_minute
)
INSERT OR IGNORE INTO booking_capacity_locks (
  organization_id, equipment_id, booking_date, minute, booking_code
)
SELECT organization_id, equipment_id, desired_date,
       printf('%02d:%02d', minute_no / 60, minute_no % 60), code
FROM expanded;
