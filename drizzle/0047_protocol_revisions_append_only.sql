-- Protocol revision history is a medical audit trail. Once a snapshot is
-- appended, neither application code nor an accidental maintenance query may
-- rewrite or delete it. Corrections must create a new protocol version.

CREATE TRIGGER IF NOT EXISTS protocol_revisions_append_only_update
BEFORE UPDATE ON protocol_revisions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'protocol revisions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS protocol_revisions_append_only_delete
BEFORE DELETE ON protocol_revisions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'protocol revisions are append-only');
END;
