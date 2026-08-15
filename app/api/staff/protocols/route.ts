import { serviceByCode } from "../../../../lib/catalog";
import { audit } from "../../../../lib/audit";
import { canAccessBooking, canManageProtocols, canSignProtocols } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { dbBinding } from "../../../../lib/db";
import {
  ProtocolSectionValues,
  protocolTemplateByKey,
} from "../../../../lib/protocols";
import {
  bookingProtocolLifecycleStatus,
  sanitizeLifecycleDocument,
  type ProtocolLifecycleDocument,
} from "../../../../lib/protocol-lifecycle";

const QUEUE_SQL = `SELECT b.id, b.code, b.name, b.service, b.service_code AS serviceCode,
    b.equipment_id AS equipmentId, b.desired_date AS desiredDate, b.desired_time AS desiredTime,
    b.performed_at AS performedAt, b.status,
    b.protocol_number AS protocolNumber, b.protocol_status AS protocolStatus,
    b.protocol_ready_at AS protocolReadyAt, b.protocol_issued_at AS protocolIssuedAt,
    b.assigned_radiologist_email AS assignedRadiologistEmail,
    COALESCE(p.status, '') AS documentStatus, COALESCE(p.version, 0) AS documentVersion,
    COALESCE(p.signed_by, '') AS signedBy, COALESCE(p.signed_at, '') AS signedAt,
    COALESCE(p.signed_version, 0) AS signedVersion
  FROM bookings b
  LEFT JOIN protocols p ON p.booking_id = b.id AND p.organization_id = b.organization_id
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

type ExistingProtocol = {
  version: number;
  authorEmail: string;
  status: string;
  templateKey: string;
  method: string;
  sectionsJson: string;
  findings: string;
  conclusion: string;
  recommendations: string;
  number: string;
  signedBy: string;
  signedAt: string;
  signedVersion: number;
};

function sameClinicalDocument(existing: ExistingProtocol, document: ProtocolLifecycleDocument): boolean {
  return existing.templateKey === document.templateKey
    && existing.method === document.method
    && existing.sectionsJson === JSON.stringify(document.sections)
    && existing.findings === document.findings
    && existing.conclusion === document.conclusion
    && existing.recommendations === document.recommendations
    && existing.number === document.number;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canManageProtocols(member.role)) {
    return Response.json({ error: "Протоколи доступні лише лікарю або адміністратору" }, { status: 403 });
  }

  const bookingId = Number(new URL(request.url).searchParams.get("bookingId"));
  if (Number.isInteger(bookingId) && bookingId > 0) {
    if (!(await canAccessBooking(db, member, bookingId, ctx.organizationId))) {
      return Response.json({ error: "Заявку не знайдено або її не призначено вам" }, { status: 404 });
    }
    const booking = await db.prepare(
      `SELECT id, code, name, service, service_code AS serviceCode, equipment_id AS equipmentId,
        desired_date AS desiredDate, desired_time AS desiredTime, patient_category AS patientCategory,
        performed_at AS performedAt, anatomical_regions_count AS anatomicalRegionsCount,
        protocol_number AS protocolNumber, protocol_status AS protocolStatus,
        protocol_ready_at AS protocolReadyAt, protocol_issued_at AS protocolIssuedAt,
        assigned_radiologist_email AS assignedRadiologistEmail
       FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1`
    ).bind(bookingId, ctx.organizationId).first<Record<string, unknown>>();
    if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
    const [row, revisions] = await Promise.all([
      db.prepare(
      `SELECT template_key AS templateKey, method, sections_json AS sectionsJson,
        findings, conclusion, recommendations, number, status, version,
        author_email AS authorEmail, updated_by AS updatedBy, updated_at AS updatedAt,
        signed_by AS signedBy, signed_at AS signedAt, signed_version AS signedVersion
       FROM protocols WHERE booking_id = ? AND organization_id = ? LIMIT 1`
      ).bind(bookingId, ctx.organizationId).first<Record<string, unknown>>(),
      db.prepare(
        `SELECT version, number, status, saved_by AS savedBy, created_at AS createdAt
         FROM protocol_revisions WHERE booking_id = ? AND organization_id = ? ORDER BY version DESC LIMIT 20`
      ).bind(bookingId, ctx.organizationId).all(),
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
          signedBy: String(row.signedBy || ""),
          signedAt: String(row.signedAt || ""),
          signedVersion: Number(row.signedVersion || 0),
        }
      : null;
    await audit(db, {
      organizationId: ctx.organizationId,
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

  // Черга протоколів обмежена організацією (tenant), далі — роллю лікаря.
  const roleClause = member.role === "admin"
    ? "WHERE b.organization_id = ? AND b.status != 'cancelled'"
    : "WHERE b.organization_id = ? AND b.status != 'cancelled' AND b.assigned_radiologist_email = ?";
  const queueSql = QUEUE_SQL.replace("WHERE b.status != 'cancelled'", roleClause);
  const queueBinds: Array<string | number> = member.role === "admin"
    ? [ctx.organizationId]
    : [ctx.organizationId, member.email];
  const queue = await db.prepare(queueSql).bind(...queueBinds).all();
  const items = (queue.results as Array<Record<string, unknown>>).map((item) => ({
    ...item,
    serviceTitle: serviceByCode(String(item.serviceCode))?.title || String(item.service),
  }));
  return Response.json({ queue: items, staff: member }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canManageProtocols(member.role)) {
    return Response.json({ error: "Протоколи може змінювати лише лікар або адміністратор" }, { status: 403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return Response.json({ error: "Некоректні дані" }, { status: 400 });
  }
  const parsed = sanitizeLifecycleDocument(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { document } = parsed;

  if (!(await canAccessBooking(db, member, bookingId, ctx.organizationId))) {
    return Response.json({ error: "Заявку не знайдено або її не призначено вам" }, { status: 404 });
  }
  const booking = await db.prepare(
    "SELECT id, equipment_id AS equipmentId FROM bookings WHERE id = ? AND organization_id = ? LIMIT 1"
  ).bind(bookingId, ctx.organizationId).first<{ id: number; equipmentId: string }>();
  if (!booking) return Response.json({ error: "Заявку не знайдено" }, { status: 404 });
  const template = protocolTemplateByKey(document.templateKey);
  if (document.templateKey !== "generic" && template.equipmentId !== booking.equipmentId) {
    return Response.json({ error: "Шаблон протоколу не відповідає типу обладнання заявки" }, { status: 400 });
  }

  const existing = await db.prepare(
    `SELECT version, author_email AS authorEmail, status,
       template_key AS templateKey, method, sections_json AS sectionsJson,
       findings, conclusion, recommendations, number,
       signed_by AS signedBy, signed_at AS signedAt, signed_version AS signedVersion
     FROM protocols WHERE booking_id = ? AND organization_id = ? LIMIT 1`
  ).bind(bookingId, ctx.organizationId).first<ExistingProtocol>();
  const baseVersion = Number(body.baseVersion ?? existing?.version ?? 0);
  if (existing && baseVersion !== Number(existing.version)) {
    return Response.json({ error: "Протокол уже змінено в іншому вікні. Оновіть сторінку." }, { status: 409 });
  }
  if (existing?.status === "issued") {
    return Response.json({ error: "Виданий протокол незмінний. Створіть окреме виправлення за регламентом." }, { status: 409 });
  }

  // Delivery is administrative state, not a new clinical revision. It is only
  // allowed for the exact already-signed version and never changes its content.
  if (document.status === "issued") {
    if (!existing || existing.status !== "signed") {
      return Response.json({ error: "Перед видачею протокол має бути підписаний лікарем-рентгенологом" }, { status: 409 });
    }
    if (!sameClinicalDocument(existing, document)) {
      return Response.json({ error: "Підписаний протокол незмінний. Оновіть сторінку перед видачею." }, { status: 409 });
    }
    let issued;
    try {
      issued = await db.prepare(
        `UPDATE protocols SET status = 'issued', updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE booking_id = ? AND organization_id = ? AND status = 'signed' AND version = ?`
      ).bind(member.email, bookingId, ctx.organizationId, existing.version).run();
    } catch {
      return Response.json({ error: "Не вдалося видати підписаний протокол. Оновіть сторінку." }, { status: 409 });
    }
    if (Number(issued.meta.changes || 0) !== 1) {
      return Response.json({ error: "Статус протоколу змінився. Оновіть сторінку." }, { status: 409 });
    }
    const state = await db.prepare(
      `SELECT b.protocol_ready_at AS protocolReadyAt, b.protocol_issued_at AS protocolIssuedAt,
        p.status AS documentStatus, p.version, p.signed_by AS signedBy,
        p.signed_at AS signedAt, p.signed_version AS signedVersion
       FROM bookings b JOIN protocols p ON p.booking_id = b.id AND p.organization_id = b.organization_id
       WHERE b.id = ? AND b.organization_id = ? LIMIT 1`
    ).bind(bookingId, ctx.organizationId).first<Record<string, unknown>>();
    if (!state || state.documentStatus !== "issued") {
      return Response.json({ error: "Статус протоколу змінився. Оновіть сторінку." }, { status: 409 });
    }
    await audit(db, {
      organizationId: ctx.organizationId,
      actorEmail: member.email,
      action: "protocol_issued",
      resource: "protocol",
      targetId: bookingId,
      details: { version: existing.version, signedVersion: existing.signedVersion },
    });
    return Response.json({
      ok: true,
      version: existing.version,
      protocolStatus: "issued",
      protocolNumber: existing.number,
      documentStatus: "issued",
      signedBy: String(state.signedBy || ""),
      signedAt: String(state.signedAt || ""),
      signedVersion: Number(state.signedVersion || 0),
      protocolReadyAt: String(state.protocolReadyAt || ""),
      protocolIssuedAt: String(state.protocolIssuedAt || ""),
    });
  }

  if (existing?.status === "signed") {
    return Response.json({ error: "Підписаний протокол незмінний. Доступна лише видача пацієнту." }, { status: 409 });
  }
  if (!existing && document.status === "signed") {
    return Response.json({ error: "Спочатку збережіть і підготуйте протокол до підпису" }, { status: 409 });
  }
  const allowedTransitions: Record<string, string[]> = {
    draft: ["draft", "ready"],
    ready: ["ready", "signed"],
  };
  if (existing && !(allowedTransitions[existing.status] || []).includes(document.status)) {
    return Response.json({ error: "Недопустимий перехід статусу протоколу" }, { status: 409 });
  }
  if (document.status === "signed" && !canSignProtocols(member.role)) {
    return Response.json({ error: "Підписати протокол може лише лікар-рентгенолог" }, { status: 403 });
  }
  if (document.number) {
    const duplicate = await db.prepare(
      "SELECT booking_id AS bookingId FROM protocols WHERE organization_id = ? AND number = ? AND booking_id != ? LIMIT 1"
    ).bind(ctx.organizationId, document.number, bookingId).first();
    if (duplicate) return Response.json({ error: "Такий номер протоколу вже використано" }, { status: 409 });
  }

  const version = existing ? Number(existing.version) + 1 : 1;
  const authorEmail = existing?.authorEmail || member.email;
  const sectionsJson = JSON.stringify(document.sections);
  const legacyStatus = bookingProtocolLifecycleStatus(document.status);
  const signedBy = document.status === "signed" ? member.email : "";
  const signedVersion = document.status === "signed" ? version : 0;
  const signedAtRow = document.status === "signed"
    ? await db.prepare("SELECT CURRENT_TIMESTAMP AS now").first<{ now: string }>()
    : null;
  const signedAt = signedAtRow?.now || "";

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO protocols
       (organization_id, booking_id, template_key, method, sections_json, findings, conclusion, recommendations,
        number, status, version, author_email, updated_by, updated_at, signed_by, signed_at, signed_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
     ON CONFLICT(booking_id) DO UPDATE SET
       organization_id = excluded.organization_id,
       template_key = excluded.template_key, method = excluded.method,
       sections_json = excluded.sections_json, findings = excluded.findings,
       conclusion = excluded.conclusion, recommendations = excluded.recommendations,
       number = excluded.number, status = excluded.status, version = excluded.version,
       updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP,
       signed_by = excluded.signed_by, signed_at = excluded.signed_at,
       signed_version = excluded.signed_version`
      ).bind(
        ctx.organizationId, bookingId, document.templateKey, document.method, sectionsJson, document.findings,
        document.conclusion, document.recommendations, document.number, document.status,
        version, authorEmail, member.email, signedBy, signedAt, signedVersion,
      ),
      db.prepare(
        `INSERT INTO protocol_revisions
           (organization_id, booking_id, version, template_key, method, sections_json, findings, conclusion,
            recommendations, number, status, saved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ctx.organizationId, bookingId, version, document.templateKey, document.method, sectionsJson,
        document.findings, document.conclusion, document.recommendations,
        document.number, document.status, member.email,
      ),
      db.prepare(
        "INSERT INTO booking_events (organization_id, booking_id, action, details, actor) VALUES (?, ?, 'protocol_document_saved', ?, ?)"
      ).bind(
        ctx.organizationId,
        bookingId,
        `${document.status} · v${version}${document.number ? ` · ${document.number}` : ""}`,
        member.email,
      ),
    ]);
  } catch {
    return Response.json({ error: "Конфлікт версій або стану протоколу. Оновіть сторінку." }, { status: 409 });
  }

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: member.email,
    action: document.status === "signed" ? "protocol_signed" : "protocol_saved",
    resource: "protocol",
    targetId: bookingId,
    details: { version, status: document.status },
  });

  const state = await db.prepare(
    `SELECT b.protocol_ready_at AS protocolReadyAt, b.protocol_issued_at AS protocolIssuedAt,
      p.signed_by AS signedBy, p.signed_at AS signedAt, p.signed_version AS signedVersion
     FROM bookings b JOIN protocols p ON p.booking_id = b.id AND p.organization_id = b.organization_id
     WHERE b.id = ? AND b.organization_id = ? LIMIT 1`
  ).bind(bookingId, ctx.organizationId).first<Record<string, unknown>>();

  return Response.json({
    ok: true,
    version,
    protocolStatus: legacyStatus,
    protocolNumber: document.number,
    documentStatus: document.status,
    signedBy: String(state?.signedBy || ""),
    signedAt: String(state?.signedAt || ""),
    signedVersion: Number(state?.signedVersion || 0),
    protocolReadyAt: String(state?.protocolReadyAt || ""),
    protocolIssuedAt: String(state?.protocolIssuedAt || ""),
  });
}