import { serviceByCode } from "../../../../lib/catalog";
import { canManageProtocols, requireStaff } from "../../../../lib/staff-auth";
import {
  ProtocolSectionValues,
  bookingProtocolStatus,
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

  const bookingId = Number(new URL(request.url).searchParams.get("bookingId"));
  if (Number.isInteger(bookingId) && bookingId > 0) {
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
    const row = await db.prepare(
      `SELECT template_key AS templateKey, method, sections_json AS sectionsJson,
        findings, conclusion, recommendations, number, status, version,
        author_email AS authorEmail, updated_by AS updatedBy, updated_at AS updatedAt
       FROM protocols WHERE booking_id = ? LIMIT 1`
    ).bind(bookingId).first<Record<string, unknown>>();
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
    return Response.json({ booking, protocol, staff: member }, { headers: { "cache-control": "no-store" } });
  }

  const queue = await db.prepare(QUEUE_SQL).all();
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

  const booking = await db.prepare("SELECT id FROM bookings WHERE id = ? LIMIT 1").bind(bookingId).first();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });

  const existing = await db.prepare(
    "SELECT version, author_email AS authorEmail FROM protocols WHERE booking_id = ? LIMIT 1"
  ).bind(bookingId).first<{ version: number; authorEmail: string }>();
  const version = existing ? Number(existing.version) + 1 : 1;
  const authorEmail = existing?.authorEmail || member.email;
  const sectionsJson = JSON.stringify(document.sections);

  await db.prepare(
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
  ).run();

  const legacyStatus = bookingProtocolStatus(document.status);
  await db.prepare(
    `UPDATE bookings SET protocol_number = ?, protocol_status = ?,
       protocol_updated_at = CURRENT_TIMESTAMP,
       protocol_ready_at = CASE
         WHEN ? IN ('ready','issued') AND protocol_ready_at = '' THEN CURRENT_TIMESTAMP
         ELSE protocol_ready_at END,
       protocol_issued_at = CASE
         WHEN ? = 'issued' AND protocol_issued_at = '' THEN CURRENT_TIMESTAMP
         ELSE protocol_issued_at END
     WHERE id = ?`
  ).bind(document.number, legacyStatus, legacyStatus, legacyStatus, bookingId).run();

  await db.prepare(
    "INSERT INTO booking_events (booking_id, action, details, actor) VALUES (?, 'protocol_document_saved', ?, ?)"
  ).bind(
    bookingId,
    `${document.status} · v${version}${document.number ? ` · ${document.number}` : ""}`,
    member.email,
  ).run();

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
