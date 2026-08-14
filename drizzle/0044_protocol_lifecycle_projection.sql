-- `protocols` is the clinical source of truth. The legacy protocol columns on
-- `bookings` are a read-model used by queues/reporting/patient cabinet and must
-- never drift from the actual protocol document.

-- Preserve an audit trace before repairing legacy booking rows that claim a
-- protocol state but have no protocol document at all. We must not fabricate a
-- clinical document from booking metadata.
INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
SELECT b.organization_id, b.id, 'protocol_projection_repaired',
       'orphan legacy state=' || b.protocol_status ||
       CASE WHEN b.protocol_number != '' THEN ' · number=' || b.protocol_number ELSE '' END,
       'system:migration-0044'
FROM bookings b
WHERE b.protocol_status != 'not_started'
  AND NOT EXISTS (
    SELECT 1 FROM protocols p
    WHERE p.booking_id = b.id AND p.organization_id = b.organization_id
  );

-- A booking without a clinical protocol document must not advertise a ready or
-- issued result to staff/patient read models.
UPDATE bookings
SET protocol_number = '',
    protocol_status = 'not_started',
    protocol_updated_at = '',
    protocol_ready_at = '',
    protocol_issued_at = ''
WHERE NOT EXISTS (
  SELECT 1 FROM protocols p
  WHERE p.booking_id = bookings.id
    AND p.organization_id = bookings.organization_id
);

-- Repair existing projections from real protocol documents before guards are
-- enabled. Preserve first-ready/first-issued timestamps when they already exist.
UPDATE bookings
SET protocol_number = COALESCE((
      SELECT p.number FROM protocols p
      WHERE p.booking_id = bookings.id
        AND p.organization_id = bookings.organization_id
    ), ''),
    protocol_status = COALESCE((
      SELECT CASE p.status
        WHEN 'draft' THEN 'in_progress'
        WHEN 'ready' THEN 'ready'
        WHEN 'issued' THEN 'issued'
        ELSE 'not_started'
      END
      FROM protocols p
      WHERE p.booking_id = bookings.id
        AND p.organization_id = bookings.organization_id
    ), 'not_started'),
    protocol_updated_at = CASE
      WHEN EXISTS (
        SELECT 1 FROM protocols p
        WHERE p.booking_id = bookings.id
          AND p.organization_id = bookings.organization_id
      ) THEN CURRENT_TIMESTAMP
      ELSE protocol_updated_at
    END,
    protocol_ready_at = CASE
      WHEN protocol_ready_at = '' AND EXISTS (
        SELECT 1 FROM protocols p
        WHERE p.booking_id = bookings.id
          AND p.organization_id = bookings.organization_id
          AND p.status IN ('ready','issued')
      ) THEN CURRENT_TIMESTAMP
      ELSE protocol_ready_at
    END,
    protocol_issued_at = CASE
      WHEN protocol_issued_at = '' AND EXISTS (
        SELECT 1 FROM protocols p
        WHERE p.booking_id = bookings.id
          AND p.organization_id = bookings.organization_id
          AND p.status = 'issued'
      ) THEN CURRENT_TIMESTAMP
      ELSE protocol_issued_at
    END
WHERE EXISTS (
  SELECT 1 FROM protocols p
  WHERE p.booking_id = bookings.id
    AND p.organization_id = bookings.organization_id
);

-- Any protocol save projects the authoritative document state to the legacy
-- booking columns. This keeps all existing queues/reports compatible while
-- making the clinical document the only source of truth.
CREATE TRIGGER IF NOT EXISTS protocols_project_booking_insert
AFTER INSERT ON protocols
FOR EACH ROW
BEGIN
  UPDATE bookings
  SET protocol_number = NEW.number,
      protocol_status = CASE NEW.status
        WHEN 'draft' THEN 'in_progress'
        WHEN 'ready' THEN 'ready'
        WHEN 'issued' THEN 'issued'
        ELSE 'not_started'
      END,
      protocol_updated_at = CURRENT_TIMESTAMP,
      protocol_ready_at = CASE
        WHEN NEW.status IN ('ready','issued') AND protocol_ready_at = '' THEN CURRENT_TIMESTAMP
        ELSE protocol_ready_at
      END,
      protocol_issued_at = CASE
        WHEN NEW.status = 'issued' AND protocol_issued_at = '' THEN CURRENT_TIMESTAMP
        ELSE protocol_issued_at
      END
  WHERE id = NEW.booking_id AND organization_id = NEW.organization_id;
END;

CREATE TRIGGER IF NOT EXISTS protocols_project_booking_update
AFTER UPDATE OF number, status ON protocols
FOR EACH ROW
BEGIN
  UPDATE bookings
  SET protocol_number = NEW.number,
      protocol_status = CASE NEW.status
        WHEN 'draft' THEN 'in_progress'
        WHEN 'ready' THEN 'ready'
        WHEN 'issued' THEN 'issued'
        ELSE 'not_started'
      END,
      protocol_updated_at = CURRENT_TIMESTAMP,
      protocol_ready_at = CASE
        WHEN NEW.status IN ('ready','issued') AND protocol_ready_at = '' THEN CURRENT_TIMESTAMP
        ELSE protocol_ready_at
      END,
      protocol_issued_at = CASE
        WHEN NEW.status = 'issued' AND protocol_issued_at = '' THEN CURRENT_TIMESTAMP
        ELSE protocol_issued_at
      END
  WHERE id = NEW.booking_id AND organization_id = NEW.organization_id;
END;

-- Protect the read-model from any direct write path. A booking protocol status
-- or number can only be written when it exactly equals the current protocol
-- document projection. This makes old/future booking endpoints fail closed.
CREATE TRIGGER IF NOT EXISTS bookings_protocol_projection_guard
BEFORE UPDATE OF protocol_status, protocol_number ON bookings
FOR EACH ROW
WHEN NEW.protocol_status != COALESCE((
       SELECT CASE p.status
         WHEN 'draft' THEN 'in_progress'
         WHEN 'ready' THEN 'ready'
         WHEN 'issued' THEN 'issued'
         ELSE 'not_started'
       END
       FROM protocols p
       WHERE p.booking_id = NEW.id AND p.organization_id = NEW.organization_id
     ), 'not_started')
  OR NEW.protocol_number != COALESCE((
       SELECT p.number
       FROM protocols p
       WHERE p.booking_id = NEW.id AND p.organization_id = NEW.organization_id
     ), '')
BEGIN
  SELECT RAISE(ABORT, 'booking protocol projection mismatch');
END;
