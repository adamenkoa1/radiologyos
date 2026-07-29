import { serviceByCode } from "../../../../lib/catalog";
import { logSecurityEvent } from "../../../../lib/audit";
import { canAccessBooking, canManageProtocols, requireStaff } from "../../../../lib/staff-auth";
import {
  ProtocolSectionValues,
  bookingProtocolStatus,
  protocolTemplateByKey,
  sanitizeDocument,
} from "../../../../lib/protocols";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

const QUEUE_SQL = `SELECT b.id, b.code, b.name, b.service, b.service_code AS serviceCode,
    b.equipment_id AS equipmentId, b.desired_date AS desiredDate, b.desired_time AS desiredTime,
    b.performed_at AS performedAt, b.status,
    b.protocol_number AS protocolNumber, b.protocol_status AS protocolStatus,
    b.protocol_ready_at AS protocolReadyAt, b.protocol_issued_at AS protocolIssuedAt,
    b.assigned_radiologist_email AS assignedRadiologistEmail,
    COALESCE(p.status, '') AS documentStatus, COALESCE(p.version, 0) AS documentVersion
  FROM bookings b
  LEFT JOIN protocols p ON p.booking_id = b.id
  WHERE b.status != 'cancelled' AND (b.performed_at != '' OR b.protocol_status != 'not_started')
  ORDER BY (b.performed_at != '') DESC, b.desired_date DESC, b.desired_time DESC
  LIMIT 300`;

function parseSections(raw: string): ProtocolSectionValues {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed as ProtocolSectionValues : {};
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageProtocols(member.role)) {
    return Response.json({ error: "Протоколи доступні лише лікарю або адміністратору" }, { status: 403 });
  }

  const bookingId = Number(new URL(request.url).searchParams.get("bookingId"));
  if (Number.isInteger(bookingId) && bookingId > 0) {
    if (!(await canAccessBooking(db, member, bookingId))) {
      return Response.json({ error: "Заявку не знайдено або її не призначено вам" }, { status: 404 });
    }
    const booking = await db.prepare(
      `SELECT id, code, name, service, service_code AS serviceCode, equipment_id AS equipmentId,
        desired_date AS desiredDate, desired_time AS desiredTime, patient_category AS patientCategory,
        performed_at AS performedAt, anatomical_regions_count AS anatomicalRegionsCount,
        protocol_number AS protocolNumber, protocol_status AS protocolStatus,
        protocol_ready_at AS protocolReadyAt, protocol_issued_at AS protocolIssuedAt,
        assigned_radiologist_email AS assignedRadiologistEmail
       FROM bookings WHERE id = ? LIMIT 1`
    ).bind(bookingId).first<Record<string, unknown>>();
    if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    const [row, revisions] = await Promise.all([
      db.prepare(
      `SELECT template_key AS templateKey, method, sections_json AS sectionsJson,
        findings, conclusion, recommendations, number, status, version,
        author_email AS authorEmail, updated_by AS updatedBy, updated_at AS updatedAt
       FROM protocols WHERE booking_id = ? LIMIT 1`
      ).bind(bookingId).first<Record<string, unknown>>(),
      db.prepare(
        `SELECT version, number, status, saved_by AS savedBy, created_at AS createdAt
         FROM protocol_revisions WHERE booking_id = ? ORDER BY version DESC LIMIT 20`
      ).bind(bookingId).all(),
    ]);
    const protocol = row
      ? {
          templateKey: String(row.templateKey),
          method: String(row.method || ""),
          sections: parseSections(String(row.sectionsJson || "{}")),
          findings: String(row.findings || ""),
          conclusion: String(row.conclusion || ""),
          recommendations: String(row.recommendations || ""),
          number: String(row.number || ""),
          status: String(row.status || "draft"),
          version: Number(row.version || 1),
          authorEmail: String(row.authorEmail || ""),
          updatedBy: String(row.updatedBy || ""),
          updatedAt: String(row.updatedAt || ""),
        }
      : null;
    await logSecurityEvent(db, {
      actorEmail: member.email,
      action: "protocol_viewed",
      resource: "protocol",
      targetId: bookingId,
    });
    return Response.json(
      { booking, protocol, revisions: revisions.results, staff: member },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const queueSql = member.role === "admin"
    ? QUEUE_SQL
    : QUEUE_SQL.replace(
        "WHERE b.status != 'cancelled'",
        "WHERE b.status != 'cancelled' AND b.assigned_radiologist_email = ?",
      );
  const queueStatement = db.prepare(queueSql);
  const queue = member.role === "admin"
    ? await queueStatement.all()
    : await queueStatement.bind(member.email).all();
  const items = (queue.results as Array<Record<string, unknown>>).map((item) => ({
    ...item,
    serviceTitle: serviceByCode(String(item.serviceCode))?.title || String(item.service),
  }));
  return Response.json({ queue: items, staff: member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageProtocols(member.role)) {
    return Response.json({ error: "Протоколи може змінювати лише лікар або адміністратор" }, { status: 403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return Response.json({ error: "Некоректні дані" }, { status: 400 });
  }
  const parsed = sanitizeDocument(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { document } = parsed;

  if (!(await canAccessBooking(db, member, bookingId))) {
    return Response.json({ error: "Заявку не знайдено або її не призначено вам" }, { status: 404 });
  }
  const booking = await db.prepare(
    "SELECT id, equipment_id AS equipmentId FROM bookings WHERE id = ? LIMIT 1"
  ).bind(bookingId).first<{ id: number; equipmentId: string }>();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  const template = protocolTemplateByKey(document.templateKey);
  if (document.templateKey !== "generic" && template.equipmentId !== booking.equipmentId) {
    return Response.json({ error: "Шаблон протоколу не відповідає типу обладнання заявки" }, { status: 400 });
  }

  const existing = await db.prepare(
    "SELECT version, author_email AS authorEmail, status FROM protocols WHERE booking_id = ? LIMIT 1"
  ).bind(bookingId).first<{ version: number; authorEmail: string; status: string }>();
  const baseVersion = Number(body.baseVersion ?? existing?.version ?? 0);
  if (existing && baseVersion !== Number(existing.version)) {
    return Response.json({ error: "Протокол уже змінено в іншому вікні. Оновіть сторінку." }, { status: 409 });
  }
  if (existing?.status === "issued") {
    return Response.json({ error: "Виданий протокол незмінний. Створіть окреме виправлення за регламентом." }, { status: 409 });
  }
  const allowedTransitions: Record<string, string[]> = {
    draft: ["draft", "ready"],
    ready: ["ready", "issued"],
  };
  if (existing && !(allowedTransitions[existing.status] || []).includes(document.status)) {
    return Response.json({ error: "Неможливо повернути протокол до попереднього статусу" }, { status: 409 });
  }
  if (document.number) {
    const duplicate = await db.prepare(
      "SELECT booking_id AS bookingId FROM protocols WHERE number = ? AND booking_id != ? LIMIT 1"
    ).bind(document.number, bookingId).first();
    if (duplicate) return Response.json({ error: "Такий номер протоколу вже використано" }, { status: 409 });
  }
  const version = existing ? Number(existing.version) + 1 : 1;
  const authorEmail = existing?.authorEmail || member.email;
  const sectionsJson = JSON.stringify(document.sections);

  const legacyStatus = bookingProtocolStatus(document.status);
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO protocols
       (booking_id, template_key, method, sections_json, findings, conclusion, recommendations,
        number, status, version, author_email, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(booking_id) DO UPDATE SET
       template_key = excluded.template_key, method = excluded.method,
       sections_json = excluded.sections_json, findings = excluded.findings,
       conclusion = excluded.conclusion, recommendations = excluded.recommendations,
       number = excluded.number, status = excluded.status, version = excluded.version,
       updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
      ).bind(
        bookingId, document.templateKey, document.method, sectionsJson, document.findings,
        document.conclusion, document.recommendations, document.number, document.status,
        version, authorEmail, member.email,
      ),
      db.prepare(
        `INSERT INTO protocol_revisions
           (booking_id, version, template_key, method, sections_json, findings, conclusion,
            recommendations, number, status, saved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        bookingId, version, document.templateKey, document.method, sectionsJson,
        document.findings, document.conclusion, document.recommendations,
        document.number, document.status, member.email,
      ),
      db.prepare(
        `UPDATE bookings SET protocol_number = ?, protocol_status = ?,
       protocol_updated_at = CURRENT_TIMESTAMP,
       protocol_ready_at = CASE
         WHEN ? IN ('ready','issued') AND protocol_ready_at = '' THEN CURRENT_TIMESTAMP
         ELSE protocol_ready_at END,
       protocol_issued_at = CASE
         WHEN ? = 'issued' AND protocol_issued_at = '' THEN CURRENT_TIMESTAMP
         ELSE protocol_issued_at END
         WHERE id = ?`
      ).bind(document.number, legacyStatus, legacyStatus, legacyStatus, bookingId),
      db.prepare(
        "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'protocol_document_saved', ?, ?)"
      ).bind(
        bookingId,
        `${document.status} · v${version}${document.number ? ` · ${document.number}` : ""}`,
        member.email,
      ),
    ]);
  } catch {
    return Response.json({ error: "Конфлікт версій протоколу. Оновіть сторінку." }, { status: 409 });
  }

  const dates = await db.prepare(
    "SELECT protocol_ready_at AS protocolReadyAt, protocol_issued_at AS protocolIssuedAt FROM bookings WHERE id = ?"
  ).bind(bookingId).first<{ protocolReadyAt: string; protocolIssuedAt: string }>();

  return Response.json({
    ok: true,
    version,
    protocolStatus: legacyStatus,
    protocolNumber: document.number,
    documentStatus: document.status,
    ...dates,
  });
}
