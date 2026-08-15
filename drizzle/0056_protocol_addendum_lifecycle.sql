-- Corrections to an already issued radiology report are separate medical
-- documents. The original protocol and its revision history remain immutable.
-- An addendum is permanently anchored to the exact issued base protocol version,
-- has its own append-only revision trail and requires a radiologist signature
-- before it may be delivered to the patient.

CREATE TABLE `protocol_addenda` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `base_protocol_version` integer NOT NULL,
  `reason` text NOT NULL DEFAULT '',
  `correction_text` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'draft',
  `version` integer NOT NULL DEFAULT 1,
  `author_email` text NOT NULL,
  `updated_by` text NOT NULL,
  `signed_by` text NOT NULL DEFAULT '',
  `signed_at` text NOT NULL DEFAULT '',
  `signed_version` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (`length`(`id`) = 32 AND `id` NOT GLOB '*[^0-9a-f]*'),
  CHECK (`length`(`trim`(`reason`)) BETWEEN 1 AND 500),
  CHECK (`length`(`trim`(`correction_text`)) BETWEEN 1 AND 12000),
  CHECK (`length`(`trim`(`author_email`)) > 0),
  CHECK (`length`(`trim`(`updated_by`)) > 0),
  CHECK (`status` IN ('draft','ready','signed','issued')),
  CHECK (`base_protocol_version` > 0),
  CHECK (`version` > 0)
);
--> statement-breakpoint
CREATE INDEX `protocol_addenda_org_booking_idx` ON `protocol_addenda` (`organization_id`, `booking_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `protocol_addenda_status_idx` ON `protocol_addenda` (`organization_id`, `status`, `updated_at`);
--> statement-breakpoint

CREATE TABLE `protocol_addendum_revisions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `addendum_id` text NOT NULL,
  `organization_id` integer NOT NULL,
  `booking_id` integer NOT NULL,
  `base_protocol_version` integer NOT NULL,
  `version` integer NOT NULL,
  `reason` text NOT NULL DEFAULT '',
  `correction_text` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'draft',
  `saved_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`addendum_id`, `version`),
  CHECK (`length`(`addendum_id`) = 32 AND `addendum_id` NOT GLOB '*[^0-9a-f]*'),
  CHECK (`length`(`trim`(`reason`)) BETWEEN 1 AND 500),
  CHECK (`length`(`trim`(`correction_text`)) BETWEEN 1 AND 12000),
  CHECK (`length`(`trim`(`saved_by`)) > 0),
  CHECK (`status` IN ('draft','ready','signed')),
  CHECK (`base_protocol_version` > 0),
  CHECK (`version` > 0)
);
--> statement-breakpoint
CREATE INDEX `protocol_addendum_revisions_scope_idx` ON `protocol_addendum_revisions` (`organization_id`, `booking_id`, `addendum_id`, `version`);
--> statement-breakpoint

CREATE TRIGGER `protocol_addenda_base_guard_insert`
BEFORE INSERT ON `protocol_addenda`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM protocols p
  WHERE p.organization_id = NEW.organization_id AND p.booking_id = NEW.booking_id
    AND p.status = 'issued' AND p.version = NEW.base_protocol_version
)
BEGIN
  SELECT RAISE(ABORT, 'protocol addendum base must be issued');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_addenda_initial_state_guard`
BEFORE INSERT ON `protocol_addenda`
FOR EACH ROW
WHEN NEW.status != 'draft' OR NEW.version != 1
  OR NEW.signed_by != '' OR NEW.signed_at != '' OR NEW.signed_version != 0
BEGIN
  SELECT RAISE(ABORT, 'protocol addendum must start as draft v1');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_addenda_scope_immutable`
BEFORE UPDATE OF `organization_id`, `booking_id`, `base_protocol_version` ON `protocol_addenda`
FOR EACH ROW
WHEN NEW.organization_id IS NOT OLD.organization_id
  OR NEW.booking_id IS NOT OLD.booking_id
  OR NEW.base_protocol_version IS NOT OLD.base_protocol_version
BEGIN
  SELECT RAISE(ABORT, 'protocol addendum scope is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_addenda_identity_immutable`
BEFORE UPDATE OF `id`, `author_email`, `created_at` ON `protocol_addenda`
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id OR NEW.author_email IS NOT OLD.author_email OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'protocol addendum identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_addenda_delete_guard`
BEFORE DELETE ON `protocol_addenda` FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'protocol addenda are immutable records'); END;
--> statement-breakpoint

CREATE TRIGGER `protocol_addenda_signature_guard_insert`
BEFORE INSERT ON `protocol_addenda`
FOR EACH ROW
WHEN (NEW.status IN ('signed','issued') AND (NEW.signed_by = '' OR NEW.signed_at = '' OR NEW.signed_version != NEW.version))
   OR (NEW.status NOT IN ('signed','issued') AND (NEW.signed_by != '' OR NEW.signed_at != '' OR NEW.signed_version != 0))
BEGIN
  SELECT RAISE(ABORT, 'protocol addendum signature state mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_addenda_signature_guard_update`
BEFORE UPDATE ON `protocol_addenda`
FOR EACH ROW
WHEN (NEW.status IN ('signed','issued') AND (NEW.signed_by = '' OR NEW.signed_at = '' OR NEW.signed_version != NEW.version))
   OR (NEW.status NOT IN ('signed','issued') AND (NEW.signed_by != '' OR NEW.signed_at != '' OR NEW.signed_version != 0))
BEGIN
  SELECT RAISE(ABORT, 'protocol addendum signature state mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER `protocol_addenda_status_transition_guard`
BEFORE UPDATE OF `status` ON `protocol_addenda`
FOR EACH ROW
WHEN (OLD.status = 'draft' AND NEW.status NOT IN ('draft','ready'))
   OR (OLD.status = 'ready' AND NEW.status NOT IN ('ready','signed'))
   OR (OLD.status = 'signed' AND NEW.status NOT IN ('signed','issued'))
   OR (OLD.status = 'issued' AND NEW.status != 'issued')
BEGIN
  SELECT RAISE(ABORT, 'invalid protocol addendum status transition');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_addenda_edit_version_guard`
BEFORE UPDATE ON `protocol_addenda`
FOR EACH ROW
WHEN OLD.status IN ('draft','ready')
  AND (
       NEW.reason IS NOT OLD.reason OR NEW.correction_text IS NOT OLD.correction_text
    OR NEW.status IS NOT OLD.status OR NEW.version IS NOT OLD.version
  )
  AND NEW.version != OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'protocol addendum edits require next version');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_addenda_signed_content_immutable`
BEFORE UPDATE ON `protocol_addenda`
FOR EACH ROW
WHEN OLD.status IN ('signed','issued') AND (
     NEW.reason IS NOT OLD.reason OR NEW.correction_text IS NOT OLD.correction_text
  OR NEW.version IS NOT OLD.version OR NEW.author_email IS NOT OLD.author_email
  OR NEW.signed_by IS NOT OLD.signed_by OR NEW.signed_at IS NOT OLD.signed_at
  OR NEW.signed_version IS NOT OLD.signed_version
)
BEGIN
  SELECT RAISE(ABORT, 'signed protocol addendum content is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER `protocol_addendum_revisions_snapshot_guard_insert`
BEFORE INSERT ON `protocol_addendum_revisions`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM protocol_addenda a
  WHERE a.id = NEW.addendum_id AND a.organization_id = NEW.organization_id
    AND a.booking_id = NEW.booking_id AND a.base_protocol_version = NEW.base_protocol_version
    AND a.version = NEW.version AND a.reason = NEW.reason
    AND a.correction_text = NEW.correction_text AND a.status = NEW.status
)
BEGIN
  SELECT RAISE(ABORT, 'protocol addendum revision must match current document');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_addendum_revisions_append_only_update`
BEFORE UPDATE ON `protocol_addendum_revisions` FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'protocol addendum revisions are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `protocol_addendum_revisions_append_only_delete`
BEFORE DELETE ON `protocol_addendum_revisions` FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'protocol addendum revisions are append-only'); END;
--> statement-breakpoint

-- Revision history is database-derived, not best-effort application logging.
CREATE TRIGGER `protocol_addendum_revision_v1`
AFTER INSERT ON `protocol_addenda`
FOR EACH ROW
BEGIN
  INSERT INTO protocol_addendum_revisions
    (addendum_id, organization_id, booking_id, base_protocol_version, version,
     reason, correction_text, status, saved_by)
  VALUES
    (NEW.id, NEW.organization_id, NEW.booking_id, NEW.base_protocol_version, NEW.version,
     NEW.reason, NEW.correction_text, NEW.status, NEW.updated_by);
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_addendum_revision_next`
AFTER UPDATE ON `protocol_addenda`
FOR EACH ROW
WHEN NEW.version = OLD.version + 1 AND NEW.status IN ('draft','ready','signed')
BEGIN
  INSERT INTO protocol_addendum_revisions
    (addendum_id, organization_id, booking_id, base_protocol_version, version,
     reason, correction_text, status, saved_by)
  VALUES
    (NEW.id, NEW.organization_id, NEW.booking_id, NEW.base_protocol_version, NEW.version,
     NEW.reason, NEW.correction_text, NEW.status, NEW.updated_by);
END;
--> statement-breakpoint

CREATE TRIGGER `protocol_addendum_issue_event`
AFTER UPDATE OF `status` ON `protocol_addenda`
FOR EACH ROW WHEN OLD.status = 'signed' AND NEW.status = 'issued'
BEGIN
  INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
  VALUES (NEW.organization_id, NEW.booking_id, 'protocol_addendum_issued',
    'addendum ' || NEW.id || ' · base v' || NEW.base_protocol_version || ' · v' || NEW.version,
    NEW.updated_by);
END;
