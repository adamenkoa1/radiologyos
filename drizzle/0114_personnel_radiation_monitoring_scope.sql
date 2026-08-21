CREATE TABLE personnel_radiation_monitoring_scope_records (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id INTEGER NOT NULL,
  personnel_id TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  scope_status TEXT NOT NULL,
  scope_text TEXT NOT NULL DEFAULT '',
  basis_title TEXT NOT NULL DEFAULT '',
  basis_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  supersedes_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (personnel_id) REFERENCES personnel_records(id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_id) REFERENCES personnel_radiation_monitoring_scope_records(id) ON DELETE RESTRICT,
  CHECK (scope_status IN ('in_scope', 'out_of_scope', 'other')),
  CHECK (scope_status <> 'in_scope' OR length(trim(scope_text)) > 0),
  CHECK (scope_status <> 'other' OR length(trim(note)) > 0)
);
--> statement-breakpoint
CREATE INDEX personnel_radiation_monitoring_scope_org_personnel_idx
  ON personnel_radiation_monitoring_scope_records(organization_id, personnel_id, effective_date DESC, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX personnel_radiation_monitoring_scope_supersedes_once_idx
  ON personnel_radiation_monitoring_scope_records(supersedes_id)
  WHERE supersedes_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_monitoring_scope_personnel_scope_insert
BEFORE INSERT ON personnel_radiation_monitoring_scope_records
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM personnel_records p
  WHERE p.id = NEW.personnel_id AND p.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_monitoring_scope_personnel_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_monitoring_scope_supersedes_scope_insert
BEFORE INSERT ON personnel_radiation_monitoring_scope_records
FOR EACH ROW
WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM personnel_radiation_monitoring_scope_records previous
  WHERE previous.id = NEW.supersedes_id
    AND previous.organization_id = NEW.organization_id
    AND previous.personnel_id = NEW.personnel_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_monitoring_scope_supersedes_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_monitoring_scope_append_only_update
BEFORE UPDATE ON personnel_radiation_monitoring_scope_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_monitoring_scope_append_only');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_monitoring_scope_append_only_delete
BEFORE DELETE ON personnel_radiation_monitoring_scope_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_monitoring_scope_append_only');
END;
