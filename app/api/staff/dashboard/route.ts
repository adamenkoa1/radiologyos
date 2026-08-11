import { serviceByCode } from "../../../../lib/catalog";
import { todayInKyiv } from "../../../../lib/booking-rules";
import { requireStaff } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { stateLabel } from "../../../../lib/study-state";
import { dbBinding } from "../../../../lib/db";

const CLINICAL_QUEUE_STATES = ["queued", "in_progress", "images_ready", "reporting", "protocol_ready"] as const;

const num = (row: Record<string, unknown> | null, key = "c") => Number(row?.[key] || 0);

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") {
    return Response.json({ error: "Зведена аналітика доступна лише адміністратору" }, { status: 403 });
  }

  const ctx = await requireOrgContext(request, db);
  const orgId = ctx?.organizationId ?? 1;

  const today = todayInKyiv();
  const weekStart = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  })();
  const one = (sql: string, ...bind: unknown[]) => db.prepare(sql).bind(...bind).first<Record<string, unknown>>();
  const many = (sql: string, ...bind: unknown[]) => db.prepare(sql).bind(...bind).all();

  const [
    scheduledToday, statusToday, performedToday,
    awaitingProtocol, readyToIssue, issuedToday,
    needImaging, availableStudies, pacs,
    outstanding, nszuPending,
    patients, repeatPatients, doNotContact,
    equipmentToday,
    needProtocolList, readyList, needImagingList, confirmList, undeliveredList,
    clinicalQueueRows,
    equipmentWeekRows,
  ] = await Promise.all([
    one("SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND desired_date = ? AND status != 'cancelled'", orgId, today),
    one("SELECT SUM(status='new') AS newc, SUM(status='confirmed') AS confirmedc FROM bookings WHERE organization_id = ? AND desired_date = ? AND status != 'cancelled'", orgId, today),
    one("SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND substr(performed_at,1,10) = ?", orgId, today),
    one("SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND performed_at != '' AND protocol_status NOT IN ('ready','issued') AND status != 'cancelled'", orgId),
    one("SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND protocol_status = 'ready'", orgId),
    one("SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND substr(protocol_issued_at,1,10) = ?", orgId, today),
    one(
      `SELECT COUNT(*) AS c FROM bookings b
       LEFT JOIN imaging_studies i ON i.booking_id = b.id AND i.organization_id = b.organization_id
       WHERE b.organization_id = ? AND b.performed_at != '' AND b.status != 'cancelled' AND i.booking_id IS NULL`,
      orgId,
    ),
    one("SELECT COUNT(*) AS c FROM imaging_studies WHERE organization_id = ? AND study_status = 'available'", orgId),
    one("SELECT enabled FROM pacs_settings WHERE organization_id = ?", orgId),
    one("SELECT COUNT(*) AS c, COALESCE(SUM(payment_amount),0) AS s FROM bookings WHERE organization_id = ? AND patient_category = 'civilian' AND status != 'cancelled' AND payment_status NOT IN ('paid','not_required')", orgId),
    one("SELECT COUNT(*) AS c FROM bookings WHERE organization_id = ? AND nszu_status = 'pending' AND status != 'cancelled'", orgId),
    one("SELECT COUNT(DISTINCT phone_normalized) AS c FROM bookings WHERE organization_id = ? AND phone_normalized != ''", orgId),
    one("SELECT COUNT(*) AS c FROM (SELECT phone_normalized FROM bookings WHERE organization_id = ? AND phone_normalized != '' GROUP BY phone_normalized HAVING COUNT(*) > 1)", orgId),
    one("SELECT COUNT(*) AS c FROM patient_profiles WHERE organization_id = ? AND do_not_contact = 1", orgId),
    many("SELECT equipment_id AS id, COUNT(*) AS c FROM bookings WHERE organization_id = ? AND desired_date = ? AND status != 'cancelled' GROUP BY equipment_id", orgId, today),
    many("SELECT id, code, name, service_code AS serviceCode, performed_at AS performedAt FROM bookings WHERE organization_id = ? AND performed_at != '' AND protocol_status NOT IN ('ready','issued') AND status != 'cancelled' ORDER BY performed_at DESC LIMIT 6", orgId),
    many("SELECT id, code, name, service_code AS serviceCode, protocol_number AS protocolNumber FROM bookings WHERE organization_id = ? AND protocol_status = 'ready' ORDER BY protocol_updated_at DESC LIMIT 6", orgId),
    many(
      `SELECT b.id, b.code, b.name, b.service_code AS serviceCode, b.performed_at AS performedAt
       FROM bookings b
       LEFT JOIN imaging_studies i ON i.booking_id = b.id AND i.organization_id = b.organization_id
       WHERE b.organization_id = ? AND b.performed_at != '' AND b.status != 'cancelled' AND i.booking_id IS NULL
       ORDER BY b.performed_at DESC LIMIT 6`,
      orgId,
    ),
    many("SELECT id, code, name, service_code AS serviceCode, desired_date AS desiredDate, desired_time AS desiredTime FROM bookings WHERE organization_id = ? AND status = 'new' ORDER BY desired_date, desired_time LIMIT 6", orgId),
    many(
      `SELECT b.id, b.code, b.name, b.phone, b.service_code AS serviceCode,
              b.desired_date AS desiredDate, b.desired_time AS desiredTime,
              MAX(n.created_at) AS failedAt
       FROM patient_notifications n
       JOIN bookings b ON b.id = n.booking_id AND b.organization_id = n.organization_id
       WHERE n.organization_id = ? AND b.organization_id = ? AND n.status = 'failed' AND b.status != 'cancelled'
       GROUP BY b.id ORDER BY failedAt DESC LIMIT 8`,
      orgId, orgId,
    ),
    many(
      `SELECT status AS s, COUNT(*) AS c FROM bookings
       WHERE organization_id = ? AND status IN ('queued','in_progress','images_ready','reporting','protocol_ready')
       GROUP BY status`,
      orgId,
    ),
    many(
      `SELECT desired_date AS d, equipment_id AS id, COUNT(*) AS c FROM bookings
       WHERE organization_id = ? AND desired_date BETWEEN ? AND ? AND status != 'cancelled'
       GROUP BY desired_date, equipment_id`,
      orgId, weekStart, today,
    ),
  ]);

  const queueCounts = new Map(
    ((clinicalQueueRows as { results?: Array<Record<string, unknown>> }).results || [])
      .map((r) => [String(r.s), Number(r.c || 0)] as const),
  );
  const clinicalQueue = CLINICAL_QUEUE_STATES.map((v) => ({ v, l: stateLabel(v), count: queueCounts.get(v) ?? 0 }));

  const withTitle = (rows: unknown) => (rows as { results?: Array<Record<string, unknown>> }).results?.map((row) => ({
    ...row, serviceTitle: serviceByCode(String(row.serviceCode))?.title || String(row.serviceCode),
  })) || [];

  return Response.json({
    today,
    kpi: {
      scheduledToday: num(scheduledToday),
      newToday: num(statusToday, "newc"),
      confirmedToday: num(statusToday, "confirmedc"),
      performedToday: num(performedToday),
      awaitingProtocol: num(awaitingProtocol),
      readyToIssue: num(readyToIssue),
      issuedToday: num(issuedToday),
      needImaging: num(needImaging),
      availableStudies: num(availableStudies),
      pacsEnabled: !!num(pacs, "enabled"),
      outstandingCount: num(outstanding),
      outstandingSum: num(outstanding, "s"),
      nszuPending: num(nszuPending),
      patients: num(patients),
      repeatPatients: num(repeatPatients),
      doNotContact: num(doNotContact),
    },
    equipmentToday: (equipmentToday as { results?: Array<Record<string, unknown>> }).results || [],
    equipmentWeek: (equipmentWeekRows as { results?: Array<Record<string, unknown>> }).results || [],
    weekStart,
    clinicalQueue,
    lists: {
      needProtocol: withTitle(needProtocolList),
      readyToIssue: withTitle(readyList),
      needImaging: withTitle(needImagingList),
      confirmQueue: withTitle(confirmList),
      undelivered: withTitle(undeliveredList),
    },
    staff: member,
  }, { headers: { "cache-control": "no-store" } });
}
