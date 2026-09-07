// Двофакторна автентифікація персоналу (TOTP). Самообслуговування: будь-який
// співробітник вмикає/вимикає 2FA для ВЛАСНого акаунта; скидання чужого 2FA
// (відновлення при втраті пристрою) — лише системний адміністратор.

import { requireSelfServiceOrgContext, requireSystemOrgContext } from "../../../../lib/tenant";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../../../../lib/totp";

const ISSUER = "RadiologyOS";
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

type TotpRow = { totpSecret: string; totpEnabled: number };

async function loadTotp(db: D1Database, email: string): Promise<TotpRow | null> {
  return db.prepare(
    "SELECT totp_secret AS totpSecret, totp_enabled AS totpEnabled FROM staff_members WHERE email = ? AND active = 1 LIMIT 1"
  ).bind(email).first<TotpRow>();
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const row = await loadTotp(db, ctx.member.email);
  return Response.json(
    { enabled: Number(row?.totpEnabled) === 1, staff: ctx.member },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { action?: string; code?: string; email?: string };
  const action = String(body.action || "");
  const code = String(body.code || "").replace(/\s+/g, "");

  // Скидання чужого 2FA — окремий адмінський шлях.
  if (action === "admin_reset") {
    const admin = await requireSystemOrgContext(request, db);
    if (!admin) return Response.json({ error: "Скидати 2FA може лише адміністратор" }, { status: 403 });
    const target = String(body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(target)) return Response.json({ error: "Некоректний обліковий запис" }, { status: 400 });
    const res = await db.prepare(
      "UPDATE staff_members SET totp_secret = '', totp_enabled = 0 WHERE email = ?"
    ).bind(target).run();
    if (!res.meta.changes) return Response.json({ error: "Обліковий запис не знайдено" }, { status: 404 });
    await audit(db, {
      organizationId: admin.organizationId, actorEmail: admin.member.email,
      action: "totp_admin_reset", resource: "auth", targetId: target,
    });
    return Response.json({ ok: true });
  }

  const ctx = await requireSelfServiceOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const email = ctx.member.email;
  const row = await loadTotp(db, email);
  if (!row) return Response.json({ error: "Обліковий запис не знайдено" }, { status: 404 });

  if (action === "begin") {
    if (Number(row.totpEnabled) === 1) {
      return Response.json({ error: "2FA вже увімкнено. Спершу вимкніть її." }, { status: 409 });
    }
    const secret = generateTotpSecret();
    await db.prepare("UPDATE staff_members SET totp_secret = ?, totp_enabled = 0 WHERE email = ?").bind(secret, email).run();
    return Response.json(
      { ok: true, secret, otpauthUri: otpauthUri(secret, { label: email, issuer: ISSUER }) },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (action === "confirm") {
    if (Number(row.totpEnabled) === 1) return Response.json({ error: "2FA вже увімкнено" }, { status: 409 });
    if (!row.totpSecret) return Response.json({ error: "Спершу почніть налаштування (begin)" }, { status: 400 });
    if (!(await verifyTotp(row.totpSecret, code))) {
      return Response.json({ error: "Невірний код. Перевірте час на пристрої та спробуйте ще раз." }, { status: 400 });
    }
    await db.prepare("UPDATE staff_members SET totp_enabled = 1 WHERE email = ?").bind(email).run();
    await audit(db, {
      organizationId: ctx.organizationId, actorEmail: email,
      action: "totp_enabled", resource: "auth", targetId: email,
    });
    return Response.json({ ok: true, enabled: true });
  }

  if (action === "disable") {
    if (Number(row.totpEnabled) !== 1) return Response.json({ error: "2FA не увімкнено" }, { status: 400 });
    if (!(await verifyTotp(row.totpSecret, code))) {
      return Response.json({ error: "Невірний код автентифікації" }, { status: 400 });
    }
    await db.prepare("UPDATE staff_members SET totp_secret = '', totp_enabled = 0 WHERE email = ?").bind(email).run();
    await audit(db, {
      organizationId: ctx.organizationId, actorEmail: email,
      action: "totp_disabled", resource: "auth", targetId: email,
    });
    return Response.json({ ok: true, enabled: false });
  }

  return Response.json({ error: "Невідома дія" }, { status: 400 });
}
