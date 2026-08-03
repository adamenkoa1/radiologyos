import { audit } from "../../../../lib/audit";
import {
  hashPassword,
  sessionCookie,
  SESSION_TTL_SECONDS,
} from "../../../../lib/auth";
import { dbBinding } from "../../../../lib/db";
import { isRateLimited } from "../../../../lib/rate-limit";
import { passwordProblem } from "../../../../lib/staff-accounts";
import {
  STAFF_ACTIVATION_KEY,
  verifyStaffActivationToken,
} from "../../../../lib/staff-activation";
import { createSession } from "../../../../lib/staff-auth";
import { normalizeUkrainianPhone } from "../../../../lib/phone";

type AdminRow = { email: string };

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "staff-activation", 6, 30)) {
    return Response.json({ error: "Забагато спроб. Спробуйте пізніше." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as {
    token?: string;
    phone?: string;
    password?: string;
  };
  const token = String(body.token || "").slice(0, 128);
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
  const password = String(body.password || "").slice(0, 200);
  if (!phone) return Response.json({ error: "Перевірте номер телефону" }, { status: 400 });
  const problem = passwordProblem(password);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  if (!await verifyStaffActivationToken(token)) {
    return Response.json({ error: "Посилання активації недійсне" }, { status: 403 });
  }

  // INSERT OR IGNORE is the one-time lock: only the first valid request may
  // provision access in this database, even if requests arrive together.
  const claim = await db.prepare(
    "INSERT OR IGNORE INTO app_settings (`key`, `value`) VALUES (?, 'used')"
  ).bind(STAFF_ACTIVATION_KEY).run();
  if (Number(claim.meta?.changes || 0) !== 1) {
    return Response.json({ error: "Це посилання вже було використано" }, { status: 409 });
  }

  const existingByPhone = await db.prepare(
    "SELECT email FROM staff_members WHERE phone = ? LIMIT 1"
  ).bind(phone).first<AdminRow>();
  const existingAdmin = existingByPhone || await db.prepare(
    "SELECT email FROM staff_members WHERE role = 'admin' ORDER BY active DESC, email LIMIT 1"
  ).first<AdminRow>();
  const email = existingAdmin?.email || `${phone}@phone.local`;
  const passwordHash = await hashPassword(password);

  if (existingAdmin) {
    await db.prepare(
      `UPDATE staff_members
       SET phone = ?, display_name = 'Адміністратор RadiologyOS',
           role = 'admin', active = 1, password_hash = ?
       WHERE email = ?`
    ).bind(phone, passwordHash, email).run();
  } else {
    await db.prepare(
      `INSERT INTO staff_members (email, phone, display_name, role, active, password_hash)
       VALUES (?, ?, 'Адміністратор RadiologyOS', 'admin', 1, ?)`
    ).bind(email, phone, passwordHash).run();
  }

  await db.batch([
    db.prepare(
      `INSERT INTO memberships (organization_id, member_email, role, active)
       VALUES (1, ?, 'admin', 1)
       ON CONFLICT(organization_id, member_email)
       DO UPDATE SET role = 'admin', active = 1`
    ).bind(email),
    db.prepare("DELETE FROM staff_sessions WHERE email = ?").bind(email),
  ]);

  await audit(db, {
    organizationId: 1,
    actorEmail: email,
    action: "owner_activation",
    resource: "auth",
    details: { phoneAttached: true },
  });
  const rawToken = await createSession(db, email);
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": sessionCookie(rawToken, SESSION_TTL_SECONDS), "cache-control": "no-store" } },
  );
}
