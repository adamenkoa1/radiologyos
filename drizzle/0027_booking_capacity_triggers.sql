-- Enforce booking capacity for every write path at the database layer.
--
-- The application still performs friendly pre-flight conflict checks, but
-- these triggers are the final invariant. Any INSERT/UPDATE that would create
-- overlapping active appointments fails on booking_capacity_locks uniqueness.
-- Because trigger effects are part of the same SQLite statement, a failed
-- reservation rolls the booking write and lock changes back together.

CREATE TABLE `booking_minute_offsets` (
  `minute_offset` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
WITH RECURSIVE seq(n) AS (
  SELECT 0
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 1439
)
INSERT INTO booking_minute_offsets (minute_offset)
SELECT n FROM seq;
--> statement-breakpoint

CREATE TRIGGER `bookings_capacity_after_insert`
AFTER INSERT ON `bookings`
WHEN NEW.status IN ('new', 'confirmed', 'rescheduled')
BEGIN
  INSERT INTO booking_capacity_locks (
    organization_id, equipment_id, booking_date, minute, booking_code
  )
  SELECT NEW.organization_id, NEW.equipment_id, NEW.desired_date,
         printf('%02d:%02d',
           ((CAST(substr(NEW.desired_time, 1, 2) AS integer) * 60
             + CAST(substr(NEW.desired_time, 4, 2) AS integer)
             + minute_offset) / 60),
           ((CAST(substr(NEW.desired_time, 1, 2) AS integer) * 60
             + CAST(substr(NEW.desired_time, 4, 2) AS integer)
             + minute_offset) % 60)
         ),
         NEW.code
  FROM booking_minute_offsets
  WHERE minute_offset < NEW.duration_minutes;
END;
--> statement-breakpoint

CREATE TRIGGER `bookings_capacity_after_update`
AFTER UPDATE OF organization_id, equipment_id, desired_date, desired_time, duration_minutes, status
ON `bookings`
BEGIN
  DELETE FROM booking_capacity_locks
  WHERE organization_id = OLD.organization_id AND booking_code = OLD.code;

  INSERT INTO booking_capacity_locks (
    organization_id, equipment_id, booking_date, minute, booking_code
  )
  SELECT NEW.organization_id, NEW.equipment_id, NEW.desired_date,
         printf('%02d:%02d',
           ((CAST(substr(NEW.desired_time, 1, 2) AS integer) * 60
             + CAST(substr(NEW.desired_time, 4, 2) AS integer)
             + minute_offset) / 60),
           ((CAST(substr(NEW.desired_time, 1, 2) AS integer) * 60
             + CAST(substr(NEW.desired_time, 4, 2) AS integer)
             + minute_offset) % 60)
         ),
         NEW.code
  FROM booking_minute_offsets
  WHERE NEW.status IN ('new', 'confirmed', 'rescheduled')
    AND minute_offset < NEW.duration_minutes;
END;
--> statement-breakpoint

CREATE TRIGGER `bookings_capacity_after_delete`
AFTER DELETE ON `bookings`
BEGIN
  DELETE FROM booking_capacity_locks
  WHERE organization_id = OLD.organization_id AND booking_code = OLD.code;
END;
