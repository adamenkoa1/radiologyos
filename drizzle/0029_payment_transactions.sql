CREATE TABLE payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'UAH',
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT NOT NULL DEFAULT '',
  refunded_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX payment_transactions_booking_idx
  ON payment_transactions (organization_id, booking_id, created_at);

CREATE UNIQUE INDEX payment_transactions_provider_ref_idx
  ON payment_transactions (organization_id, provider, provider_reference)
  WHERE provider_reference != '';
