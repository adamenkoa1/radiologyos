type Database = D1Database;

async function digestKey(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function fingerprint(request: Request, scope: string) {
  // Лише cf-connecting-ip (за Cloudflare встановлюється завжди й не
  // підробляється клієнтом). Без нього — єдиний спільний кошик, а не
  // клієнтський проксі-заголовок, який дозволяв би обхід ліміту через підміну.
  const source = request.headers.get("cf-connecting-ip") || "no-ip";
  return digestKey(`${scope}:${source.trim()}`);
}

async function identifierFingerprint(scope: string, identifier: string) {
  // Ідентифікатор акаунта ніколи не зберігається у request_limits у відкритому вигляді.
  return digestKey(`${scope}:identifier:${identifier.trim().toLowerCase()}`);
}

async function incrementLimit(db: Database, key: string, limit: number, windowMinutes: number) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowMinutes * 60;
  await db.prepare(
    `INSERT INTO request_limits (key, attempts, window_started_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       attempts = CASE WHEN window_started_at < ? THEN 1 ELSE attempts + 1 END,
       window_started_at = CASE WHEN window_started_at < ? THEN ? ELSE window_started_at END`
  ).bind(key, now, cutoff, cutoff, now).run();
  const row = await db.prepare(
    "SELECT attempts FROM request_limits WHERE key = ?"
  ).bind(key).first<{ attempts: number }>();
  if (Math.random() < 0.02) {
    await db.prepare("DELETE FROM request_limits WHERE window_started_at < ?")
      .bind(now - 86400).run();
  }
  return (row?.attempts || 0) > limit;
}

export async function isRateLimited(
  db: Database,
  request: Request,
  scope: string,
  limit: number,
  windowMinutes: number,
) {
  return incrementLimit(db, await fingerprint(request, scope), limit, windowMinutes);
}

export async function isIdentifierRateLimited(
  db: Database,
  scope: string,
  identifier: string,
  limit: number,
  windowMinutes: number,
) {
  if (!identifier.trim()) return false;
  const key = await identifierFingerprint(scope, identifier);
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowMinutes * 60;
  const row = await db.prepare(
    "SELECT attempts, window_started_at AS windowStartedAt FROM request_limits WHERE key = ?"
  ).bind(key).first<{ attempts: number; windowStartedAt: number }>();
  return Boolean(row && row.windowStartedAt >= cutoff && row.attempts >= limit);
}

export async function recordIdentifierRateLimitFailure(
  db: Database,
  scope: string,
  identifier: string,
  limit: number,
  windowMinutes: number,
) {
  if (!identifier.trim()) return false;
  return incrementLimit(db, await identifierFingerprint(scope, identifier), limit, windowMinutes);
}

export async function clearIdentifierRateLimit(
  db: Database,
  scope: string,
  identifier: string,
) {
  if (!identifier.trim()) return;
  await db.prepare("DELETE FROM request_limits WHERE key = ?")
    .bind(await identifierFingerprint(scope, identifier)).run();
}
