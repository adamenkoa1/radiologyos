-- Enforce booking capacity for every write path at the database layer.
--
-- The application still performs friendly pre-flight conflict checks, but
-- these triggers are the final invariant. Any INSERT/UPDATE that would create
-- overlapping active appointments fails at the booking_capacity_locks layer.
-- Trigger effects are part of the same SQLite statement, so failed capacity
-- reservations roll the booking write and lock changes back together.

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

-- Public booking also reserves locks explicitly in its D1 batch. Re-inserting
-- an identical lock for the same booking is therefore an idempotent no-op,
-- while a different booking competing for the same capacity is aborted with a
-- stable error message that routes can translate to HTTP 409.
CREATE TRIGGER `booking_capacity_same_booking_ignore`
BEFORE INSERT ON `booking_capacity_locks`
WHEN EXISTS (
  SELECT 1 FROM booking_capacity_locks l
  WHERE l.organization_id = NEW.organization_id
    AND l.equipment_id = NEW.equipment_id
    AND l.booking_date = NEW.booking_date
    AND l.minute = NEW.minute
    AND l.booking_code = NEW.booking_code
)
BEGIN
  SELECT RAISE(IGNORE);
END;
--> statement-breakpoint

CREATE TRIGGER `booking_capacity_conflict_abort`
BEFORE INSERT ON `booking_capacity_locks`
WHEN EXISTS (
  SELECT 1 FROM booking_capacity_locks l
  WHERE l.organization_id = NEW.organization_id
    AND l.equipment_id = NEW.equipment_id
    AND l.booking_date = NEW.booking_date
    AND l.minute = NEW.minute
    AND l.booking_code <> NEW.booking_code
)
BEGIN
  SELECT RAISE(ABORT, 'booking capacity conflict');
END;
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
