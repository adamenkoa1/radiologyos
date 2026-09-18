-- A protocol-issued audit event must represent a real state transition, not an
-- attempted API call. Keep this invariant in D1 so concurrent requests cannot
-- append duplicate delivery events after one request already moved signed -> issued.

CREATE TRIGGER IF NOT EXISTS `protocols_issue_transition_event`
AFTER UPDATE OF `status` ON `protocols`
FOR EACH ROW
WHEN OLD.status = 'signed' AND NEW.status = 'issued'
BEGIN
  INSERT INTO `booking_events`
    (`organization_id`, `booking_id`, `action`, `details`, `actor`)
  VALUES (
    NEW.organization_id,
    NEW.booking_id,
    'protocol_issued',
    'signed v' || NEW.signed_version,
    NEW.updated_by
  );
END;
