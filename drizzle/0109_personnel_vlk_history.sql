CREATE TABLE personnel_vlk_records (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id INTEGER NOT NULL,
  personnel_id TEXT NOT NULL,
  examination_date TEXT NOT NULL,
  decision_code TEXT NOT NULL,
  decision_text TEXT NOT NULL DEFAULT '',
  valid_until TEXT NOT NULL DEFAULT '',
  commission_name TEXT NOT NULL DEFAULT '',
  document_number TEXT NOT NULL DEFAULT '',
  supersedes_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (personnel_id) REFERENCES personnel_records(id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_id) REFERENCES personnel_vlk_records(id) ON DELETE RESTRICT,
  CHECK (decision_code IN ('fit', 'temporarily_unfit', 'unfit', 'other'))
);
--> statement-breakpoint
CREATE INDEX personnel_vlk_records_org_personnel_idx
  ON personnel_vlk_records(organization_id, personnel_id, examination_date DESC, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX personnel_vlk_records_supersedes_once_idx
  ON personnel_vlk_records(supersedes_id)
  WHERE supersedes_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER personnel_vlk_records_personnel_scope_insert
BEFORE INSERT ON personnel_vlk_records
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM personnel_records p
  WHERE p.id = NEW.personnel_id AND p.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_vlk_personnel_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_vlk_records_supersedes_scope_insert
BEFORE INSERT ON personnel_vlk_records
FOR EACH ROW
WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM personnel_vlk_records previous
  WHERE previous.id = NEW.supersedes_id
    AND previous.organization_id = NEW.organization_id
    AND previous.personnel_id = NEW.personnel_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_vlk_supersedes_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_vlk_records_append_only_update
BEFORE UPDATE ON personnel_vlk_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_vlk_append_only');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_vlk_records_append_only_delete
BEFORE DELETE ON personnel_vlk_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_vlk_append_only');
END;
