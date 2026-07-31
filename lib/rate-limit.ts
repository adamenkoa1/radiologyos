type Database = D1Database;

async function fingerprint(request: Request, scope: string) {
  // Лише cf-connecting-ip (за Cloudflare встановлюється завжди й не
  // підробляється клієнтом). Без нього — єдиний спільний кошик, а не
  // клієнтський проксі-заголовок, який дозволяв би обхід ліміту через підміну.
  const source = request.headers.get("cf-connecting-ip") || "no-ip";
  const bytes = new TextEncoder().encode(`${scope}:${source.trim()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function isRateLimited(
  db: Database,
  request: Request,
  scope: string,
  limit: number,
  windowMinutes: number,
) {
  const key = await fingerprint(request, scope);
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
