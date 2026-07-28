// Shared key/value access for the `app_settings` table — department-configurable
// values such as the Telegram bot credentials and the payment link.

export async function getSetting(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(key).first<{ value: string }>();
  return row?.value || "";
}

export async function getSettings(db: D1Database, keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = await getSetting(db, key);
  return out;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
}
