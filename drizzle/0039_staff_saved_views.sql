CREATE TABLE IF NOT EXISTS staff_saved_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  member_email TEXT NOT NULL,
  surface TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (member_email) REFERENCES staff_members(email) ON DELETE CASCADE,
  UNIQUE (organization_id, member_email, surface, name)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS staff_saved_views_owner_surface_idx
  ON staff_saved_views (organization_id, member_email, surface, updated_at DESC);
