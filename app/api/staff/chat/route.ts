// Єдиний контакт-центр пацієнтів. Історія береться з patient_communications
// незалежно від каналу; ручні відповіді поки відправляються через legacy-global
// WhatsApp-шлюз org 1. Усі читання та записи tenant-scoped; secondary tenants
// можуть читати свою історію, але не використовувати глобальний шлюз для reply.

import { canViewPatientRegistry } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { sendWhatsApp } from "../../../../lib/whatsapp";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

const PRIMARY_ORGANIZATION_ID = 1;
const CHANNELS = new Set(["whatsapp", "telegram", "sms", "email"]);

function channelFilter(request: Request): string {
  const value = (new URL(request.url).searchParams.get("channel") || "").trim().toLowerCase();
  return CHANNELS.has(value) ? value : "";
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  const orgId = ctx.organizationId;
  if (!canViewPatientRegistry(member.role)) return Response.json({ error: "Контакт-центр доступний реєстратору або адміністратору" }, { status: 403 });

  const url = new URL(request.url);
  const phone = normalizeUkrainianPhone(url.searchParams.get("phone") || "");
  const channel = channelFilter(request);

  if (phone) {
    const rows = channel
      ? await db.prepare(
          `SELECT id, channel, direction, summary AS text, actor, external_id AS externalId, created_at AS createdAt
           FROM patient_communications
           WHERE phone_normalized = ? AND organization_id = ? AND channel = ?
           ORDER BY created_at ASC, id ASC LIMIT 400`
        ).bind(phone, orgId, channel).all()
      : await db.prepare(
          `SELECT id, channel, direction, summary AS text, actor, external_id AS externalId, created_at AS createdAt
           FROM patient_communications
           WHERE phone_normalized = ? AND organization_id = ?
           ORDER BY created_at ASC, id ASC LIMIT 400`
        ).bind(phone, orgId).all();

    // Use ordinary positional placeholders here. Node's SQLite test runtime and
    // D1 both accept them reliably; repeated numbered ?1/?2 parameters in this
    // scalar-subquery shape trigger SQLITE_RANGE in node:sqlite.
    const patient = await db.prepare(
      `SELECT COALESCE(
         (SELECT display_name FROM patient_profiles WHERE phone_normalized = ? AND organization_id = ?),
         (SELECT name FROM bookings WHERE phone_normalized = ? AND organization_id = ? ORDER BY id DESC LIMIT 1), '') AS name,
       CASE WHEN EXISTS (
         SELECT 1 FROM patient_telegram_identities ti
         WHERE ti.phone_normalized = ? AND ti.organization_id = ? AND ti.telegram_chat_id != ''
       ) THEN 1 ELSE 0 END AS telegramLinked`
    ).bind(phone, orgId, phone, orgId, phone, orgId).first<{ name: string; telegramLinked: number }>();

    const issues = await db.prepare(
      `SELECT n.id, n.channel, n.kind, n.status, n.error, n.created_at AS createdAt, n.booking_id AS bookingId
       FROM patient_notifications n
       JOIN bookings b ON b.id = n.booking_id AND b.organization_id = n.organization_id
       WHERE n.organization_id = ? AND b.phone_normalized = ? AND n.status = 'failed'
       ORDER BY n.id DESC LIMIT 30`
    ).bind(orgId, phone).all();

    await audit(db, {
      organizationId: orgId,
      actorEmail: member.email,
      action: "contact_center_thread_viewed",
      resource: "patient_communication",
      targetId: phone,
      details: { channel: channel || "all" },
    });

    return Response.json({
      phone,
      name: patient?.name || "",
      messages: rows.results,
      issues: issues.results,
      availableReplyChannels: orgId === PRIMARY_ORGANIZATION_ID ? ["whatsapp"] : [],
      linkedTelegram: Number(patient?.telegramLinked || 0) === 1,
      staff: member,
    }, { headers: { "cache-control": "no-store" } });
  }

  const conversations = channel
    ? await db.prepare(
        `SELECT c.phone_normalized AS phone, c.summary AS lastText, c.direction AS lastDirection,
                c.channel AS lastChannel, c.created_at AS lastAt,
                COALESCE(
                  (SELECT display_name FROM patient_profiles p WHERE p.phone_normalized = c.phone_normalized AND p.organization_id = ?1),
                  (SELECT name FROM bookings b WHERE b.phone_normalized = c.phone_normalized AND b.organization_id = ?1 ORDER BY id DESC LIMIT 1), '') AS name,
                (SELECT COUNT(*) FROM patient_notifications n
                   JOIN bookings b2 ON b2.id = n.booking_id AND b2.organization_id = n.organization_id
                  WHERE n.organization_id = ?1 AND b2.phone_normalized = c.phone_normalized AND n.status = 'failed') AS issueCount
         FROM patient_communications c
         JOIN (SELECT phone_normalized, MAX(id) AS maxId FROM patient_communications
               WHERE organization_id = ?1 AND channel = ?2 GROUP BY phone_normalized) m
           ON m.phone_normalized = c.phone_normalized AND m.maxId = c.id
         WHERE c.organization_id = ?1
         ORDER BY c.created_at DESC LIMIT 150`
      ).bind(orgId, channel).all()
    : await db.prepare(
        `SELECT c.phone_normalized AS phone, c.summary AS lastText, c.direction AS lastDirection,
                c.channel AS lastChannel, c.created_at AS lastAt,
                COALESCE(
                  (SELECT display_name FROM patient_profiles p WHERE p.phone_normalized = c.phone_normalized AND p.organization_id = ?1),
                  (SELECT name FROM bookings b WHERE b.phone_normalized = c.phone_normalized AND b.organization_id = ?1 ORDER BY id DESC LIMIT 1), '') AS name,
                (SELECT COUNT(*) FROM patient_notifications n
                   JOIN bookings b2 ON b2.id = n.booking_id AND b2.organization_id = n.organization_id
                  WHERE n.organization_id = ?1 AND b2.phone_normalized = c.phone_normalized AND n.status = 'failed') AS issueCount
         FROM patient_communications c
         JOIN (SELECT phone_normalized, MAX(id) AS maxId FROM patient_communications
               WHERE organization_id = ?1 GROUP BY phone_normalized) m
           ON m.phone_normalized = c.phone_normalized AND m.maxId = c.id
         WHERE c.organization_id = ?1
         ORDER BY c.created_at DESC LIMIT 150`
      ).bind(orgId).all();

  const channelStats = await db.prepare(
    `SELECT channel, COUNT(*) AS count
     FROM patient_communications
     WHERE organization_id = ?
     GROUP BY channel`
  ).bind(orgId).all();
  const failed = await db.prepare(
    `SELECT COUNT(*) AS count FROM patient_notifications WHERE organization_id = ? AND status = 'failed'`
  ).bind(orgId).first<{ count: number }>();

  return Response.json({
    conversations: conversations.results,
    channelStats: channelStats.results,
    failedDeliveries: Number(failed?.count || 0),
    activeChannel: channel || "all",
    staff: member,
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canViewPatientRegistry(member.role)) return Response.json({ error: "Відповідати може реєстратор або адміністратор" }, { status: 403 });
  if (ctx.organizationId !== PRIMARY_ORGANIZATION_ID) {
    return Response.json({ error: "Вихідний WhatsApp ще не налаштований для цієї організації" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { phone?: string; text?: string; channel?: string };
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
  const text = String(body.text || "").trim().slice(0, 2000);
  const channel = String(body.channel || "whatsapp").trim().toLowerCase();
  if (!phone || !text) return Response.json({ error: "Вкажіть номер і текст повідомлення" }, { status: 400 });
  if (channel !== "whatsapp") return Response.json({ error: "Ручна відповідь для цього каналу ще не підключена" }, { status: 400 });

  const patientExists = await db.prepare(
    `SELECT 1 AS ok FROM (
       SELECT phone_normalized FROM patient_profiles WHERE organization_id = ?1 AND phone_normalized = ?2
       UNION ALL
       SELECT phone_normalized FROM bookings WHERE organization_id = ?1 AND phone_normalized = ?2 LIMIT 1
     ) LIMIT 1`
  ).bind(ctx.organizationId, phone).first<{ ok: number }>();
  if (!patientExists) return Response.json({ error: "Пацієнта не знайдено в цій організації" }, { status: 404 });

  const result = await sendWhatsApp(db, phone, text);
  if (!result.ok) return Response.json({ error: result.error || "Не вдалося надіслати" }, { status: 400 });

  await db.prepare(
    `INSERT INTO patient_communications (organization_id, phone_normalized, channel, direction, summary, actor, external_id)
     VALUES (?, ?, 'whatsapp', 'outbound', ?, ?, ?)`
  ).bind(ctx.organizationId, phone, text, member.email, result.idMessage || "").run();
  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: member.email,
    action: "contact_center_message_sent",
    resource: "patient_communication",
    targetId: phone,
    details: { channel: "whatsapp", length: text.length },
  });

  return Response.json({ ok: true, message: { direction: "outbound", channel: "whatsapp", text, actor: member.email, createdAt: new Date().toISOString() } });
}
