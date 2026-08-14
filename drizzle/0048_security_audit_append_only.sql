-- Security audit rows are evidentiary records. Once written, application or
-- ad-hoc SQL must not rewrite or delete the history of access to medical data.
CREATE TRIGGER IF NOT EXISTS `security_audit_log_append_only_update`
BEFORE UPDATE ON `security_audit_log`
BEGIN
  SELECT RAISE(ABORT, 'security audit log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `security_audit_log_append_only_delete`
BEFORE DELETE ON `security_audit_log`
BEGIN
  SELECT RAISE(ABORT, 'security audit log is append-only');
END;
