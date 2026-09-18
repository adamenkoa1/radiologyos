CREATE TABLE personnel_radiation_clearance_records (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id INTEGER NOT NULL,
  personnel_id TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  decision_code TEXT NOT NULL,
  scope_text TEXT NOT NULL DEFAULT '',
  valid_until TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT '',
  document_number TEXT NOT NULL DEFAULT '',
  document_date TEXT NOT NULL DEFAULT '',
  issued_by TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  supersedes_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (personnel_id) REFERENCES personnel_records(id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_id) REFERENCES personnel_radiation_clearance_records(id) ON DELETE RESTRICT,
  CHECK (decision_code IN ('authorized', 'suspended', 'revoked', 'other'))
);
--> statement-breakpoint
CREATE INDEX personnel_radiation_clearance_org_personnel_idx
  ON personnel_radiation_clearance_records(organization_id, personnel_id, effective_date DESC, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX personnel_radiation_clearance_supersedes_once_idx
  ON personnel_radiation_clearance_records(supersedes_id)
  WHERE supersedes_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_clearance_personnel_scope_insert
BEFORE INSERT ON personnel_radiation_clearance_records
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM personnel_records p
  WHERE p.id = NEW.personnel_id AND p.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_clearance_personnel_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_clearance_supersedes_scope_insert
BEFORE INSERT ON personnel_radiation_clearance_records
FOR EACH ROW
WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM personnel_radiation_clearance_records previous
  WHERE previous.id = NEW.supersedes_id
    AND previous.organization_id = NEW.organization_id
    AND previous.personnel_id = NEW.personnel_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_clearance_supersedes_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_clearance_append_only_update
BEFORE UPDATE ON personnel_radiation_clearance_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_clearance_append_only');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_clearance_append_only_delete
BEFORE DELETE ON personnel_radiation_clearance_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_clearance_append_only');
END;
