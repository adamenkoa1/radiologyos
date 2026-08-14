-- Protocol documents must belong to the same tenant as their booking.
-- Existing API queries are tenant scoped, but these triggers make the invariant
-- physical in D1 so an accidental future write cannot create a cross-tenant row.

CREATE TRIGGER IF NOT EXISTS protocols_booking_tenant_insert
BEFORE INSERT ON protocols
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.id = NEW.booking_id AND b.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'protocol booking tenant mismatch');
END;

CREATE TRIGGER IF NOT EXISTS protocols_booking_tenant_update
BEFORE UPDATE OF booking_id, organization_id ON protocols
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.id = NEW.booking_id AND b.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'protocol booking tenant mismatch');
END;

CREATE TRIGGER IF NOT EXISTS protocol_revisions_booking_tenant_insert
BEFORE INSERT ON protocol_revisions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.id = NEW.booking_id AND b.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'protocol revision booking tenant mismatch');
END;

CREATE TRIGGER IF NOT EXISTS protocol_revisions_booking_tenant_update
BEFORE UPDATE OF booking_id, organization_id ON protocol_revisions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.id = NEW.booking_id AND b.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'protocol revision booking tenant mismatch');
END;
