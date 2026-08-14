CREATE TABLE IF NOT EXISTS booking_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  author_email TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS booking_comments_org_booking_idx
  ON booking_comments (organization_id, booking_id, id DESC);

CREATE INDEX IF NOT EXISTS booking_comments_org_author_idx
  ON booking_comments (organization_id, author_email, id DESC);
