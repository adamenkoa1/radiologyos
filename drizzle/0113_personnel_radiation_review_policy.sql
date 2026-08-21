CREATE TABLE personnel_radiation_review_policy_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  require_clearance_valid_until INTEGER NOT NULL DEFAULT 0,
  training_max_age_days INTEGER,
  knowledge_check_max_age_days INTEGER,
  dosimetry_max_age_days INTEGER,
  source_title TEXT NOT NULL DEFAULT '',
  source_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  supersedes_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_id) REFERENCES personnel_radiation_review_policy_revisions(id) ON DELETE RESTRICT,
  CHECK (enabled IN (0, 1)),
  CHECK (require_clearance_valid_until IN (0, 1)),
  CHECK (training_max_age_days IS NULL OR training_max_age_days BETWEEN 1 AND 36500),
  CHECK (knowledge_check_max_age_days IS NULL OR knowledge_check_max_age_days BETWEEN 1 AND 36500),
  CHECK (dosimetry_max_age_days IS NULL OR dosimetry_max_age_days BETWEEN 1 AND 36500)
);
--> statement-breakpoint
CREATE INDEX personnel_radiation_review_policy_org_effective_idx
  ON personnel_radiation_review_policy_revisions(organization_id, effective_from DESC, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX personnel_radiation_review_policy_one_root_idx
  ON personnel_radiation_review_policy_revisions(organization_id)
  WHERE supersedes_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX personnel_radiation_review_policy_supersedes_once_idx
  ON personnel_radiation_review_policy_revisions(supersedes_id)
  WHERE supersedes_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_review_policy_supersedes_scope_insert
BEFORE INSERT ON personnel_radiation_review_policy_revisions
FOR EACH ROW
WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM personnel_radiation_review_policy_revisions previous
  WHERE previous.id = NEW.supersedes_id
    AND previous.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_review_policy_supersedes_scope');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_review_policy_effective_order_insert
BEFORE INSERT ON personnel_radiation_review_policy_revisions
FOR EACH ROW
WHEN NEW.supersedes_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM personnel_radiation_review_policy_revisions previous
  WHERE previous.id = NEW.supersedes_id
    AND previous.organization_id = NEW.organization_id
    AND previous.effective_from > NEW.effective_from
)
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_review_policy_effective_order');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_review_policy_append_only_update
BEFORE UPDATE ON personnel_radiation_review_policy_revisions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_review_policy_append_only');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_radiation_review_policy_append_only_delete
BEFORE DELETE ON personnel_radiation_review_policy_revisions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel_radiation_review_policy_append_only');
END;
