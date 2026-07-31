import { serviceByCode } from "../../../../lib/catalog";
import { todayInKyiv } from "../../../../lib/booking-rules";
import { requireStaff } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { stateLabel } from "../../../../lib/study-state";
import { dbBinding } from "../../../../lib/db";

// Клінічна черга пульта — активні стани дослідження за єдиною state machine.
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

  // Контекст організації — для tenant-scoped клінічної черги (organization_id
  // лише із серверної сесії). За відсутності членства обмежуємося початковим tenant.
  const ctx = await requireOrgContext(request, db);
  const orgId = ctx?.organizationId ?? 1;

  const today = todayInKyiv();
  const one = (sql: string, ...bind: unknown[]) => db.prepare(sql).bind(...bind).first<Record<string, unknown>>();
  const many = (sql: string, ...bind: unknown[]) => db.prepare(sql).bind(...bind).all();

  const [
    scheduledToday, statusToday, performedToday,
    awaitingProtocol, readyToIssue, issuedToday,
    needImaging, availableStudies, pacs,
    outstanding, nszuPending,
    patients, repeatPatients, doNotContact,
    equipmentToday,
    needProtocolList, readyList, needImagingList, confirmList,
    clinicalQueueRows,
  ] = await Promise.all([
    one("SELECT COUNT(*) AS c FROM bookings WHERE desired_date = ? AND status != 'cancelled'", today),
    one("SELECT SUM(status='new') AS newc, SUM(status='confirmed') AS confirmedc FROM bookings WHERE desired_date = ? AND status != 'cancelled'", today),
    one("SELECT COUNT(*) AS c FROM bookings WHERE substr(performed_at,1,10) = ?", today),
    one("SELECT COUNT(*) AS c FROM bookings WHERE performed_at != '' AND protocol_status NOT IN ('ready','issued') AND status != 'cancelled'"),
    one("SELECT COUNT(*) AS c FROM bookings WHERE protocol_status = 'ready'"),
    one("SELECT COUNT(*) AS c FROM bookings WHERE substr(protocol_issued_at,1,10) = ?", today),
    one("SELECT COUNT(*) AS c FROM bookings b LEFT JOIN imaging_studies i ON i.booking_id = b.id WHERE b.performed_at != '' AND b.status != 'cancelled' AND i.booking_id IS NULL"),
    one("SELECT COUNT(*) AS c FROM imaging_studies WHERE study_status = 'available'"),
    one("SELECT enabled FROM pacs_settings WHERE id = 1"),
    one("SELECT COUNT(*) AS c, COALESCE(SUM(payment_amount),0) AS s FROM bookings WHERE patient_category = 'civilian' AND status != 'cancelled' AND payment_status NOT IN ('paid','not_required')"),
    one("SELECT COUNT(*) AS c FROM bookings WHERE nszu_status = 'pending' AND status != 'cancelled'"),
    one("SELECT COUNT(DISTINCT phone_normalized) AS c FROM bookings WHERE phone_normalized != ''"),
    one("SELECT COUNT(*) AS c FROM (SELECT phone_normalized FROM bookings WHERE phone_normalized != '' GROUP BY phone_normalized HAVING COUNT(*) > 1)"),
    one("SELECT COUNT(*) AS c FROM patient_profiles WHERE do_not_contact = 1"),
    many("SELECT equipment_id AS id, COUNT(*) AS c FROM bookings WHERE desired_date = ? AND status != 'cancelled' GROUP BY equipment_id", today),
    many("SELECT id, code, name, service_code AS serviceCode, performed_at AS performedAt FROM bookings WHERE performed_at != '' AND protocol_status NOT IN ('ready','issued') AND status != 'cancelled' ORDER BY performed_at DESC LIMIT 6"),
    many("SELECT id, code, name, service_code AS serviceCode, protocol_number AS protocolNumber FROM bookings WHERE protocol_status = 'ready' ORDER BY protocol_updated_at DESC LIMIT 6"),
    many("SELECT b.id, b.code, b.name, b.service_code AS serviceCode, b.performed_at AS performedAt FROM bookings b LEFT JOIN imaging_studies i ON i.booking_id = b.id WHERE b.performed_at != '' AND b.status != 'cancelled' AND i.booking_id IS NULL ORDER BY b.performed_at DESC LIMIT 6"),
    many("SELECT id, code, name, service_code AS serviceCode, desired_date AS desiredDate, desired_time AS desiredTime FROM bookings WHERE status = 'new' ORDER BY desired_date, desired_time LIMIT 6"),
    // Клінічна черга — лічильники активних станів дослідження (tenant-scoped).
    many(
      `SELECT status AS s, COUNT(*) AS c FROM bookings
       WHERE organization_id = ? AND status IN ('queued','in_progress','images_ready','reporting','protocol_ready')
       GROUP BY status`,
      orgId,
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
    clinicalQueue,
    lists: {
      needProtocol: withTitle(needProtocolList),
      readyToIssue: withTitle(readyList),
      needImaging: withTitle(needImagingList),
      confirmQueue: withTitle(confirmList),
    },
    staff: member,
  }, { headers: { "cache-control": "no-store" } });
}
