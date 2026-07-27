import { createSession } from "../../../../lib/staff-auth";
import { sessionCookie, SESSION_TTL_SECONDS, verifyPassword } from "../../../../lib/auth";
import { isRateLimited } from "../../../../lib/rate-limit";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "staff-login", 10, 15)) {
    return Response.json({ error: "Забагато спроб входу. Спробуйте за 15 хвилин." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as { email?: string; password?: string };
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  const password = String(body.password || "");
  if (!email || !password) return Response.json({ error: "Вкажіть email і пароль" }, { status: 400 });

  const member = await db.prepare(
    "SELECT email, display_name AS displayName, role, password_hash AS passwordHash FROM staff_members WHERE email = ? AND active = 1 LIMIT 1"
  ).bind(email).first<{ email: string; displayName: string; role: string; passwordHash: string }>();

  const ok = member ? await verifyPassword(password, member.passwordHash) : false;
  if (!member || !ok) {
    return Response.json({ error: "Невірний email або пароль" }, { status: 401 });
  }

  const rawToken = await createSession(db, member.email);
  return Response.json(
    { ok: true, staff: { email: member.email, displayName: member.displayName, role: member.role } },
    { headers: { "set-cookie": sessionCookie(rawToken, SESSION_TTL_SECONDS), "cache-control": "no-store" } },
  );
}
