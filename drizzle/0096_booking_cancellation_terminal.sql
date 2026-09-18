-- Booking cancellation is a terminal business-core transition.
-- Reinstatement must create a new booking / Patient Order instead of resurrecting closed history.

CREATE TRIGGER `booking_cancelled_terminal`
BEFORE UPDATE OF `status` ON `bookings`
WHEN OLD.status='cancelled' AND NEW.status<>'cancelled'
BEGIN
  SELECT RAISE(ABORT,'booking_cancelled_terminal');
END;
--> statement-breakpoint
