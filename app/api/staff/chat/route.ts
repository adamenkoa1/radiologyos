// Чат з пацієнтами (WhatsApp-листування). Реєстратор/адмін бачать діалоги і
// відповідають прямо з кабінету. Історія — у patient_communications
// (channel='whatsapp').

import { canViewPatientRegistry } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { sendWhatsApp } from "../../../../lib/whatsapp";
import { dbBinding } from "../../../../lib/db";

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  const orgId = ctx.organizationId;
  if (!canViewPatientRegistry(member.role)) return Response.json({ error: "Чат доступний реєстратору або адміністратору" }, { status: 403 });

  const phone = normalizeUkrainianPhone(new URL(request.url).searchParams.get("phone") || "");
  if (phone) {
    const rows = await db.prepare(
      `SELECT id, direction, summary AS text, actor, created_at AS createdAt
       FROM patient_communications WHERE phone_normalized = ? AND organization_id = ? AND channel = 'whatsapp'
       ORDER BY created_at ASC, id ASC LIMIT 300`
    ).bind(phone, orgId).all();
    const name = await db.prepare(
      `SELECT COALESCE(
         (SELECT display_name FROM patient_profiles WHERE phone_normalized = ?1 AND organization_id = ?2),
         (SELECT name FROM bookings WHERE phone_normalized = ?1 AND organization_id = ?2 ORDER BY id DESC LIMIT 1), '') AS name`
    ).bind(phone, orgId).first<{ name: string }>();
    return Response.json({ phone, name: name?.name || "", messages: rows.results, staff: member }, { headers: { "cache-control": "no-store" } });
  }

  const conversations = await db.prepare(
    `SELECT c.phone_normalized AS phone, c.summary AS lastText, c.direction AS lastDirection,
       c.created_at AS lastAt,
       COALESCE(
         (SELECT display_name FROM patient_profiles p WHERE p.phone_normalized = c.phone_normalized AND p.organization_id = ?1),
         (SELECT name FROM bookings b WHERE b.phone_normalized = c.phone_normalized AND b.organization_id = ?1 ORDER BY id DESC LIMIT 1), '') AS name
     FROM patient_communications c
     JOIN (SELECT phone_normalized, MAX(id) AS maxId FROM patient_communications
           WHERE channel = 'whatsapp' AND organization_id = ?1 GROUP BY phone_normalized) m
       ON m.phone_normalized = c.phone_normalized AND m.maxId = c.id
     WHERE c.organization_id = ?1
     ORDER BY c.created_at DESC LIMIT 100`
  ).bind(orgId).all();
  return Response.json({ conversations: conversations.results, staff: member }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canViewPatientRegistry(member.role)) return Response.json({ error: "Відповідати може реєстратор або адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { phone?: string; text?: string };
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
  const text = String(body.text || "").trim().slice(0, 2000);
  if (!phone || !text) return Response.json({ error: "Вкажіть номер і текст повідомлення" }, { status: 400 });

  const result = await sendWhatsApp(db, phone, text);
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося надіслати" }, { status: 400 });

  await db.prepare(
    `INSERT INTO patient_communications (organization_id, phone_normalized, channel, direction, summary, actor, external_id)
     VALUES (?, ?, 'whatsapp', 'outbound', ?, ?, ?)`
  ).bind(ctx.organizationId, phone, text, member.email, result.idMessage || "").run();
  return Response.json({ ok: true, message: { direction: "outbound", text, actor: member.email, createdAt: new Date().toISOString() } });
}
