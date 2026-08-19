-- Enforce the canonical protocol lifecycle in D1. Existing historical rows are
-- preserved; only new inserts and future state transitions are constrained.
CREATE TRIGGER `protocols_status_domain_guard_insert`
BEFORE INSERT ON `protocols`
FOR EACH ROW
WHEN NEW.`status` NOT IN ('draft','ready','signed','issued')
BEGIN
  SELECT RAISE(ABORT, 'protocol status invalid');
END;
--> statement-breakpoint
-- SQLite executes BEFORE INSERT triggers before resolving ON CONFLICT DO UPDATE.
-- Therefore finalized input is rejected only when there is no existing protocol
-- row for this booking. Existing-row UPSERTs then flow through the UPDATE
-- transition guard below, which enforces the actual old -> new lifecycle edge.
CREATE TRIGGER `protocols_initial_status_guard`
BEFORE INSERT ON `protocols`
FOR EACH ROW
WHEN NEW.`status` NOT IN ('draft','ready')
 AND NOT EXISTS (
   SELECT 1 FROM `protocols` p WHERE p.`booking_id` = NEW.`booking_id`
 )
BEGIN
  SELECT RAISE(ABORT, 'protocol must start draft or ready');
END;
--> statement-breakpoint
CREATE TRIGGER `protocols_status_domain_guard_update`
BEFORE UPDATE OF `status` ON `protocols`
FOR EACH ROW
WHEN NEW.`status` NOT IN ('draft','ready','signed','issued')
BEGIN
  SELECT RAISE(ABORT, 'protocol status invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `protocols_unsigned_status_transition_guard`
BEFORE UPDATE OF `status` ON `protocols`
FOR EACH ROW
WHEN (OLD.`status` = 'draft' AND NEW.`status` NOT IN ('draft','ready'))
   OR (OLD.`status` = 'ready' AND NEW.`status` NOT IN ('ready','signed'))
BEGIN
  SELECT RAISE(ABORT, 'protocol status transition invalid');
END;
