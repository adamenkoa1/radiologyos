CREATE TABLE IF NOT EXISTS staff_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  due_date TEXT NOT NULL DEFAULT '',
  booking_id INTEGER,
  assigned_email TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  completed_by TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS staff_tasks_org_status_due_idx
ON staff_tasks (organization_id, status, due_date, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS staff_tasks_org_assignee_idx
ON staff_tasks (organization_id, assigned_email, status, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS staff_tasks_org_booking_idx
ON staff_tasks (organization_id, booking_id, id);
