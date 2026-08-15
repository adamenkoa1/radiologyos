-- A patient-linked staff task must belong to the same tenant as its booking.
-- Operational tasks with booking_id IS NULL remain department-wide.

CREATE TRIGGER IF NOT EXISTS `staff_tasks_booking_tenant_insert`
BEFORE INSERT ON `staff_tasks`
FOR EACH ROW
WHEN NEW.booking_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = NEW.booking_id
      AND b.organization_id = NEW.organization_id
  )
BEGIN
  SELECT RAISE(ABORT, 'staff task booking tenant mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `staff_tasks_booking_tenant_update`
BEFORE UPDATE OF `organization_id`, `booking_id` ON `staff_tasks`
FOR EACH ROW
WHEN NEW.booking_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = NEW.booking_id
      AND b.organization_id = NEW.organization_id
  )
BEGIN
  SELECT RAISE(ABORT, 'staff task booking tenant mismatch');
END;
