// Єдиний контакт-центр пацієнтів. Історія береться з patient_communications
// незалежно від каналу; ручні відповіді поки відправляються через legacy-global
// WhatsApp-шлюз org 1.
//
// КРИТИЧНА ІНВАРІАНТА: phone — лише контакт, а не identity. Exact-діалоги
// групуються та читаються виключно за immutable patient_id. Старі записи без
// patient_id залишаються окремими legacy phone-buckets і ніколи автоматично не
// домішуються до exact-пацієнта, навіть якщо номер збігається.

import { canViewPatientRegistry } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { sendWhatsApp } from "../../../../lib/whatsapp";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

const PRIMARY_ORGANIZATION_ID = 1;
const CHANNELS = new Set(["whatsapp", "telegram", "sms", "email"]);
const PATIENT_ID = /^[a-f0-9]{32}$/i;

function channelFilter(request: Request): string {
  const value = (new URL(request.url).searchParams.get("channel") || "").trim().toLowerCase();
  return CHANNELS.has(value) ? value : "";
}

function exactPatientId(value: string | null | undefined): string {
  const patientId = String(value || "").trim().toLowerCase();
  return PATIENT_ID.test(patientId) ? patientId : "";
}

async function resolvePhoneCompatibilityScope(
  db: D1Database,
  organizationId: number,
  phone: string,
  channel: string,
): Promise<{ patientId: string; legacyPhone: string; ambiguous: boolean }> {
  const row = channel
    ? await db.prepare(
        `SELECT COUNT(DISTINCT CASE
                  WHEN patient_id != '' THEN 'patient:' || patient_id
                  ELSE 'legacy:' || phone_normalized END) AS scopeCount,
                COALESCE(MAX(CASE WHEN patient_id != '' THEN patient_id ELSE '' END), '') AS patientId,
                MAX(CASE WHEN patient_id = '' THEN 1 ELSE 0 END) AS hasLegacy
         FROM patient_communications
         WHERE organization_id = ? AND phone_normalized = ? AND channel = ?`
      ).bind(organizationId, phone, channel).first<{ scopeCount:number; patientId:string; hasLegacy:number }>()
    : await db.prepare(
        `SELECT COUNT(DISTINCT CASE
                  WHEN patient_id != '' THEN 'patient:' || patient_id
                  ELSE 'legacy:' || phone_normalized END) AS scopeCount,
                COALESCE(MAX(CASE WHEN patient_id != '' THEN patient_id ELSE '' END), '') AS patientId,
                MAX(CASE WHEN patient_id = '' THEN 1 ELSE 0 END) AS hasLegacy
         FROM patient_communications
         WHERE organization_id = ? AND phone_normalized = ?`
      ).bind(organizationId, phone).first<{ scopeCount:number; patientId:string; hasLegacy:number }>();

  const scopeCount = Number(row?.scopeCount || 0);
  if (scopeCount > 1) return { patientId:"", legacyPhone:"", ambiguous:true };
  const patientId = exactPatientId(row?.patientId || "");
  if (patientId) return { patientId, legacyPhone:"", ambiguous:false };
  return { patientId:"", legacyPhone:Number(row?.hasLegacy || 0) === 1 ? phone : "", ambiguous:false };
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  const orgId = ctx.organizationId;
  if (!canViewPatientRegistry(member.role)) {
    return Response.json({ error: "Контакт-центр доступний реєстратору або адміністратору" }, { status: 403 });
  }

  const url = new URL(request.url);
  const channel = channelFilter(request);
  let patientId = exactPatientId(url.searchParams.get("patientId"));
  let legacyPhone = normalizeUkrainianPhone(url.searchParams.get("legacyPhone") || "");
  const compatibilityPhone = normalizeUkrainianPhone(url.searchParams.get("phone") || "");

  // Backward compatibility for old bookmarks/callers: phone-only reads are
  // accepted only when that phone maps to exactly one communication scope.
  // Scope ambiguity is global across channels: a channel filter may narrow
  // messages only after identity has already been resolved safely.
  if (!patientId && !legacyPhone && compatibilityPhone) {
    const scope = await resolvePhoneCompatibilityScope(db, orgId, compatibilityPhone, "");
    if (scope.ambiguous) {
      return Response.json({
        error: "Цей номер містить кілька окремих історій. Виберіть конкретного пацієнта або legacy-історію.",
      }, { status: 409, headers:{ "cache-control":"no-store" } });
    }
    patientId = scope.patientId;
    legacyPhone = scope.legacyPhone;
  }

  if (patientId || legacyPhone) {
    if (patientId) {
      const profile = await db.prepare(
        `SELECT display_name AS name, phone_normalized AS phone, do_not_contact AS doNotContact
         FROM patient_profiles
         WHERE organization_id = ? AND patient_id = ? LIMIT 1`
      ).bind(orgId, patientId).first<{ name:string; phone:string; doNotContact:number }>();

      // Exact patient identity is tenant-scoped and authoritative. If the
      // patient does not exist in this organization, fail closed immediately;
      // never consult communication rows or phone compatibility fallback.
      if (!profile) {
        return Response.json({ error:"Діалог пацієнта не знайдено" }, { status:404, headers:{ "cache-control":"no-store" } });
      }

      const rows = channel
        ? await db.prepare(
            `SELECT id, patient_id AS patientId, channel, direction, summary AS text, actor,
                    external_id AS externalId, phone_normalized AS phone, created_at AS createdAt
             FROM patient_communications
             WHERE organization_id = ? AND patient_id = ? AND channel = ?
             ORDER BY created_at ASC, id ASC LIMIT 400`
          ).bind(orgId, patientId, channel).all()
        : await db.prepare(
            `SELECT id, patient_id AS patientId, channel, direction, summary AS text, actor,
                    external_id AS externalId, phone_normalized AS phone, created_at AS createdAt
             FROM patient_communications
             WHERE organization_id = ? AND patient_id = ?
             ORDER BY created_at ASC, id ASC LIMIT 400`
          ).bind(orgId, patientId).all();

      const issues = await db.prepare(
        `SELECT n.id, n.channel, n.kind, n.status, n.error, n.created_at AS createdAt, n.booking_id AS bookingId
         FROM patient_notifications n
         JOIN bookings b ON b.id = n.booking_id AND b.organization_id = n.organization_id
         WHERE n.organization_id = ? AND b.patient_id = ? AND n.status = 'failed'
         ORDER BY n.id DESC LIMIT 30`
      ).bind(orgId, patientId).all();

      const telegram = await db.prepare(
        `SELECT 1 AS linked FROM patient_telegram_identities
         WHERE organization_id = ? AND patient_id = ? AND telegram_chat_id != '' LIMIT 1`
      ).bind(orgId, patientId).first<{ linked:number }>();

      const shared = profile.phone
        ? await db.prepare(
            `SELECT COUNT(*) AS count FROM patient_profiles
             WHERE organization_id = ? AND phone_normalized = ?`
          ).bind(orgId, profile.phone).first<{ count:number }>()
        : null;

      await audit(db, {
        organizationId: orgId,
        actorEmail: member.email,
        action: "contact_center_thread_viewed",
        resource: "patient_communication",
        targetId: patientId,
        details: { channel:channel || "all", identityKind:"patient" },
      });

      return Response.json({
        conversationKey:`patient:${patientId}`,
        identityKind:"patient",
        patientId,
        phone:profile.phone,
        name:profile.name || "",
        sharedPhone:Number(shared?.count || 0) > 1,
        messages:rows.results,
        issues:issues.results,
        availableReplyChannels:
          orgId === PRIMARY_ORGANIZATION_ID && !!profile.phone && Number(profile.doNotContact || 0) !== 1
            ? ["whatsapp"] : [],
        linkedTelegram:Number(telegram?.linked || 0) === 1,
        staff:member,
      }, { headers:{ "cache-control":"no-store" } });
    }

    const rows = channel
      ? await db.prepare(
          `SELECT id, patient_id AS patientId, channel, direction, summary AS text, actor,
                  external_id AS externalId, phone_normalized AS phone, created_at AS createdAt
           FROM patient_communications
           WHERE organization_id = ? AND patient_id = '' AND phone_normalized = ? AND channel = ?
           ORDER BY created_at ASC, id ASC LIMIT 400`
        ).bind(orgId, legacyPhone, channel).all()
      : await db.prepare(
          `SELECT id, patient_id AS patientId, channel, direction, summary AS text, actor,
                  external_id AS externalId, phone_normalized AS phone, created_at AS createdAt
           FROM patient_communications
           WHERE organization_id = ? AND patient_id = '' AND phone_normalized = ?
           ORDER BY created_at ASC, id ASC LIMIT 400`
        ).bind(orgId, legacyPhone).all();

    if (rows.results.length === 0) {
      return Response.json({ error:"Legacy-діалог не знайдено" }, { status:404, headers:{ "cache-control":"no-store" } });
    }

    const identity = await db.prepare(
      `WITH input(org_id, phone) AS (VALUES (?, ?))
       SELECT
         (SELECT COUNT(*) FROM patient_profiles p
          WHERE p.organization_id = i.org_id AND p.phone_normalized = i.phone) AS exactProfileCount,
         (SELECT COUNT(*) FROM bookings b
          WHERE b.organization_id = i.org_id AND b.phone_normalized = i.phone AND b.patient_id = '') AS legacyBookingCount,
         COALESCE((SELECT MAX(name) FROM bookings b
          WHERE b.organization_id = i.org_id AND b.phone_normalized = i.phone AND b.patient_id = ''
          HAVING COUNT(*) = 1), '') AS name
       FROM input i`
    ).bind(orgId, legacyPhone).first<{ exactProfileCount:number; legacyBookingCount:number; name:string }>();

    const issues = await db.prepare(
      `SELECT n.id, n.channel, n.kind, n.status, n.error, n.created_at AS createdAt, n.booking_id AS bookingId
       FROM patient_notifications n
       JOIN bookings b ON b.id = n.booking_id AND b.organization_id = n.organization_id
       WHERE n.organization_id = ? AND b.patient_id = '' AND b.phone_normalized = ? AND n.status = 'failed'
       ORDER BY n.id DESC LIMIT 30`
    ).bind(orgId, legacyPhone).all();

    const exactProfileCount = Number(identity?.exactProfileCount || 0);
    const legacyBookingCount = Number(identity?.legacyBookingCount || 0);

    await audit(db, {
      organizationId:orgId,
      actorEmail:member.email,
      action:"contact_center_thread_viewed",
      resource:"patient_communication",
      targetId:`legacy:${legacyPhone}`,
      details:{ channel:channel || "all", identityKind:"legacy", exactProfileCount, legacyBookingCount },
    });

    return Response.json({
      conversationKey:`legacy:${legacyPhone}`,
      identityKind:"legacy",
      patientId:"",
      phone:legacyPhone,
      name:identity?.name || "",
      sharedPhone:exactProfileCount > 1,
      messages:rows.results,
      issues:issues.results,
      availableReplyChannels:
        orgId === PRIMARY_ORGANIZATION_ID && exactProfileCount === 0 && legacyBookingCount === 1
          ? ["whatsapp"] : [],
      linkedTelegram:false,
      legacyAmbiguous:exactProfileCount > 0 || legacyBookingCount !== 1,
      staff:member,
    }, { headers:{ "cache-control":"no-store" } });
  }

  const conversations = channel
    ? await db.prepare(
        `WITH input(org_id, channel) AS (VALUES (?, ?)),
         latest AS (
           SELECT CASE WHEN pc.patient_id != '' THEN 'patient:' || pc.patient_id ELSE 'legacy:' || pc.phone_normalized END AS conversationKey,
                  MAX(pc.id) AS maxId
           FROM patient_communications pc
           CROSS JOIN input i
           WHERE pc.organization_id = i.org_id AND pc.channel = i.channel
           GROUP BY conversationKey
         )
         SELECT latest.conversationKey,
                CASE WHEN c.patient_id != '' THEN 'patient' ELSE 'legacy' END AS identityKind,
                c.patient_id AS patientId,
                CASE WHEN c.patient_id != '' THEN COALESCE((
                  SELECT p.phone_normalized FROM patient_profiles p
                  WHERE p.organization_id = i.org_id AND p.patient_id = c.patient_id LIMIT 1
                ), c.phone_normalized) ELSE c.phone_normalized END AS phone,
                c.summary AS lastText, c.direction AS lastDirection, c.channel AS lastChannel,
                c.created_at AS lastAt,
                CASE WHEN c.patient_id != '' THEN COALESCE((
                  SELECT p.display_name FROM patient_profiles p
                  WHERE p.organization_id = i.org_id AND p.patient_id = c.patient_id LIMIT 1
                ), '')
                WHEN (SELECT COUNT(*) FROM bookings b
                      WHERE b.organization_id = i.org_id AND b.patient_id = '' AND b.phone_normalized = c.phone_normalized) = 1
                THEN COALESCE((SELECT MAX(b2.name) FROM bookings b2
                               WHERE b2.organization_id = i.org_id AND b2.patient_id = '' AND b2.phone_normalized = c.phone_normalized), '')
                ELSE '' END AS name,
                CASE WHEN c.patient_id != '' THEN (
                  SELECT COUNT(*) FROM patient_profiles p3
                  WHERE p3.organization_id = i.org_id AND p3.phone_normalized = COALESCE((
                    SELECT p4.phone_normalized FROM patient_profiles p4
                    WHERE p4.organization_id = i.org_id AND p4.patient_id = c.patient_id LIMIT 1
                  ), c.phone_normalized)
                ) ELSE (
                  SELECT COUNT(*) FROM patient_profiles p5
                  WHERE p5.organization_id = i.org_id AND p5.phone_normalized = c.phone_normalized
                ) END AS exactProfileCount,
                CASE WHEN c.patient_id != '' THEN (
                  SELECT COUNT(*) FROM patient_notifications n
                  JOIN bookings b3 ON b3.id = n.booking_id AND b3.organization_id = n.organization_id
                  WHERE n.organization_id = i.org_id AND b3.patient_id = c.patient_id AND n.status = 'failed'
                ) ELSE (
                  SELECT COUNT(*) FROM patient_notifications n
                  JOIN bookings b4 ON b4.id = n.booking_id AND b4.organization_id = n.organization_id
                  WHERE n.organization_id = i.org_id AND b4.patient_id = '' AND b4.phone_normalized = c.phone_normalized AND n.status = 'failed'
                ) END AS issueCount
         FROM latest
         CROSS JOIN input i
         JOIN patient_communications c ON c.id = latest.maxId AND c.organization_id = i.org_id
         ORDER BY c.created_at DESC, c.id DESC LIMIT 150`
      ).bind(orgId, channel).all()
    : await db.prepare(
        `WITH input(org_id) AS (VALUES (?)),
         latest AS (
           SELECT CASE WHEN pc.patient_id != '' THEN 'patient:' || pc.patient_id ELSE 'legacy:' || pc.phone_normalized END AS conversationKey,
                  MAX(pc.id) AS maxId
           FROM patient_communications pc
           CROSS JOIN input i
           WHERE pc.organization_id = i.org_id
           GROUP BY conversationKey
         )
         SELECT latest.conversationKey,
                CASE WHEN c.patient_id != '' THEN 'patient' ELSE 'legacy' END AS identityKind,
                c.patient_id AS patientId,
                CASE WHEN c.patient_id != '' THEN COALESCE((
                  SELECT p.phone_normalized FROM patient_profiles p
                  WHERE p.organization_id = i.org_id AND p.patient_id = c.patient_id LIMIT 1
                ), c.phone_normalized) ELSE c.phone_normalized END AS phone,
                c.summary AS lastText, c.direction AS lastDirection, c.channel AS lastChannel,
                c.created_at AS lastAt,
                CASE WHEN c.patient_id != '' THEN COALESCE((
                  SELECT p.display_name FROM patient_profiles p
                  WHERE p.organization_id = i.org_id AND p.patient_id = c.patient_id LIMIT 1
                ), '')
                WHEN (SELECT COUNT(*) FROM bookings b
                      WHERE b.organization_id = i.org_id AND b.patient_id = '' AND b.phone_normalized = c.phone_normalized) = 1
                THEN COALESCE((SELECT MAX(b2.name) FROM bookings b2
                               WHERE b2.organization_id = i.org_id AND b2.patient_id = '' AND b2.phone_normalized = c.phone_normalized), '')
                ELSE '' END AS name,
                CASE WHEN c.patient_id != '' THEN (
                  SELECT COUNT(*) FROM patient_profiles p3
                  WHERE p3.organization_id = i.org_id AND p3.phone_normalized = COALESCE((
                    SELECT p4.phone_normalized FROM patient_profiles p4
                    WHERE p4.organization_id = i.org_id AND p4.patient_id = c.patient_id LIMIT 1
                  ), c.phone_normalized)
                ) ELSE (
                  SELECT COUNT(*) FROM patient_profiles p5
                  WHERE p5.organization_id = i.org_id AND p5.phone_normalized = c.phone_normalized
                ) END AS exactProfileCount,
                CASE WHEN c.patient_id != '' THEN (
                  SELECT COUNT(*) FROM patient_notifications n
                  JOIN bookings b3 ON b3.id = n.booking_id AND b3.organization_id = n.organization_id
                  WHERE n.organization_id = i.org_id AND b3.patient_id = c.patient_id AND n.status = 'failed'
                ) ELSE (
                  SELECT COUNT(*) FROM patient_notifications n
                  JOIN bookings b4 ON b4.id = n.booking_id AND b4.organization_id = n.organization_id
                  WHERE n.organization_id = i.org_id AND b4.patient_id = '' AND b4.phone_normalized = c.phone_normalized AND n.status = 'failed'
                ) END AS issueCount
         FROM latest
         CROSS JOIN input i
         JOIN patient_communications c ON c.id = latest.maxId AND c.organization_id = i.org_id
         ORDER BY c.created_at DESC, c.id DESC LIMIT 150`
      ).bind(orgId).all();

  const channelStats = await db.prepare(
    `SELECT channel, COUNT(*) AS count FROM patient_communications
     WHERE organization_id = ? GROUP BY channel`
  ).bind(orgId).all();
  const failed = await db.prepare(
    `SELECT COUNT(*) AS count FROM patient_notifications WHERE organization_id = ? AND status = 'failed'`
  ).bind(orgId).first<{ count:number }>();

  const normalizedConversations = (conversations.results as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    sharedPhone:Number(row.exactProfileCount || 0) > 1,
    legacyAmbiguous:row.identityKind === "legacy" && Number(row.exactProfileCount || 0) > 0,
  }));

  return Response.json({
    conversations:normalizedConversations,
    channelStats:channelStats.results,
    failedDeliveries:Number(failed?.count || 0),
    activeChannel:channel || "all",
    staff:member,
  }, { headers:{ "cache-control":"no-store" } });
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  const member = ctx.member;
  if (!canViewPatientRegistry(member.role)) {
    return Response.json({ error:"Відповідати може реєстратор або адміністратор" }, { status:403 });
  }
  if (ctx.organizationId !== PRIMARY_ORGANIZATION_ID) {
    return Response.json({ error:"Вихідний WhatsApp ще не налаштований для цієї організації" }, { status:403 });
  }

  const body = await request.json().catch(() => ({})) as {
    patientId?:string; phone?:string; text?:string; channel?:string; identityKind?:string;
  };
  const patientId = exactPatientId(body.patientId);
  const requestedPhone = normalizeUkrainianPhone(String(body.phone || ""));
  const text = String(body.text || "").trim().slice(0, 2000);
  const channel = String(body.channel || "whatsapp").trim().toLowerCase();
  if (!text) return Response.json({ error:"Вкажіть текст повідомлення" }, { status:400 });
  if (channel !== "whatsapp") {
    return Response.json({ error:"Ручна відповідь для цього каналу ще не підключена" }, { status:400 });
  }

  let phone = requestedPhone;
  let storedPatientId = "";

  if (patientId) {
    const profile = await db.prepare(
      `SELECT phone_normalized AS phone, do_not_contact AS doNotContact
       FROM patient_profiles WHERE organization_id = ? AND patient_id = ? LIMIT 1`
    ).bind(ctx.organizationId, patientId).first<{ phone:string; doNotContact:number }>();
    if (!profile) return Response.json({ error:"Пацієнта не знайдено в цій організації" }, { status:404 });
    phone = normalizeUkrainianPhone(profile.phone || "");
    if (!phone) return Response.json({ error:"У картці пацієнта немає коректного номера" }, { status:409 });
    if (requestedPhone && requestedPhone !== phone) {
      return Response.json({ error:"Контакт пацієнта змінився. Оновіть діалог перед відправленням." }, { status:409 });
    }
    if (Number(profile.doNotContact || 0) === 1) {
      return Response.json({ error:"Для пацієнта встановлено заборону на контакт" }, { status:409 });
    }
    storedPatientId = patientId;
  } else {
    if (!phone) return Response.json({ error:"Вкажіть номер отримувача" }, { status:400 });
    const identity = await db.prepare(
      `WITH input(org_id, phone) AS (VALUES (?, ?))
       SELECT
         (SELECT COUNT(*) FROM patient_profiles p
          WHERE p.organization_id = i.org_id AND p.phone_normalized = i.phone) AS exactProfileCount,
         (SELECT COUNT(*) FROM bookings b
          WHERE b.organization_id = i.org_id AND b.phone_normalized = i.phone AND b.patient_id = '') AS legacyBookingCount
       FROM input i`
    ).bind(ctx.organizationId, phone).first<{ exactProfileCount:number; legacyBookingCount:number }>();
    const exactProfileCount = Number(identity?.exactProfileCount || 0);
    const legacyBookingCount = Number(identity?.legacyBookingCount || 0);
    if (exactProfileCount > 0) {
      return Response.json({
        error:"Цей номер належить exact-профілю. Виберіть конкретного пацієнта перед відправленням.",
      }, { status:409 });
    }
    if (legacyBookingCount === 0) {
      return Response.json({ error:"Пацієнта не знайдено в цій організації" }, { status:404 });
    }
    if (legacyBookingCount !== 1) {
      return Response.json({
        error:"Legacy-номер пов'язаний з кількома записами. Спочатку ідентифікуйте пацієнта в CRM.",
      }, { status:409 });
    }
  }

  const result = await sendWhatsApp(db, phone, text);
  if (!result.ok) return Response.json({ error:result.error || "Не вдалося надіслати" }, { status:400 });

  await db.prepare(
    `INSERT INTO patient_communications
       (organization_id, patient_id, phone_normalized, channel, direction, summary, actor, external_id)
     VALUES (?, ?, ?, 'whatsapp', 'outbound', ?, ?, ?)`
  ).bind(ctx.organizationId, storedPatientId, phone, text, member.email, result.idMessage || "").run();
  await audit(db, {
    organizationId:ctx.organizationId,
    actorEmail:member.email,
    action:"contact_center_message_sent",
    resource:"patient_communication",
    targetId:storedPatientId || `legacy:${phone}`,
    details:{ channel:"whatsapp", length:text.length, identityKind:storedPatientId ? "patient" : "legacy" },
  });

  return Response.json({
    ok:true,
    message:{ patientId:storedPatientId, direction:"outbound", channel:"whatsapp", text, actor:member.email, createdAt:new Date().toISOString() },
  });
}
