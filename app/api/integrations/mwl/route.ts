import { todayInKyiv } from "../../../../lib/booking-rules";
import { dbBinding } from "../../../../lib/db";
import {
  canonicalWorklistAccession,
  dateSpanDays,
  generateDicomPatientId,
  hashBridgeToken,
  modalityForWorklist,
  mwlIdentityKey,
  parseBearerToken,
  validIsoDate,
  type MwlFeedItem,
} from "../../../../lib/mwl-bridge";

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

type FeedRow = {
  code: string;
  patientId: string;
  patientName: string;
  patientBirthDate: string;
  service: string;
  serviceCode: string;
  equipmentId: string;
  scheduledDate: string;
  scheduledTime: string;
  imagingAccession: string;
};

async function patientIdsForRows(db: D1Database, organizationId: number, rows: FeedRow[]) {
  const keys = [...new Set(rows.map((row) => mwlIdentityKey(row.patientId, row.code)))];
  if (!keys.length) return new Map<string, string>();
  const placeholders = keys.map(() => "?").join(",");
  const load = async () => db.prepare(
    `SELECT identity_key AS identityKey, patient_id AS patientId
     FROM mwl_patient_ids
     WHERE organization_id = ? AND identity_key IN (${placeholders})`,
  ).bind(organizationId, ...keys).all<{ identityKey: string; patientId: string }>();

  let existing = await load();
  const known = new Set(existing.results.map((row) => row.identityKey));
  const missing = keys.filter((key) => !known.has(key));
  if (missing.length) {
    await db.batch(missing.map((key) => db.prepare(
      `INSERT OR IGNORE INTO mwl_patient_ids
        (organization_id, identity_key, patient_id, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
    ).bind(organizationId, key, generateDicomPatientId())));
    existing = await load();
  }
  return new Map(existing.results.map((row) => [row.identityKey, row.patientId]));
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });

  const token = parseBearerToken(request);
  if (!token) return Response.json({ error: "Потрібен bridge token" }, { status: 401 });
  const tokenHash = await hashBridgeToken(token);
  const bridge = await db.prepare(
    `SELECT t.organization_id AS organizationId, o.name AS organizationName
     FROM mwl_bridge_tokens t
     JOIN organizations o ON o.id = t.organization_id AND o.active = 1
     WHERE t.token_hash = ? AND t.active = 1 LIMIT 1`,
  ).bind(tokenHash).first<{ organizationId: number; organizationName: string }>();
  if (!bridge) return Response.json({ error: "Недійсний bridge token" }, { status: 401 });

  const url = new URL(request.url);
  const today = todayInKyiv();
  const from = url.searchParams.get("from") || today;
  const to = url.searchParams.get("to") || addDays(from, 7);
  const modalityFilter = String(url.searchParams.get("modality") || "").toUpperCase();
  if (!validIsoDate(from) || !validIsoDate(to) || from > to || dateSpanDays(from, to) > 31) {
    return Response.json({ error: "Некоректний період; максимум 31 день" }, { status: 400 });
  }
  if (modalityFilter && !["CT", "DX", "RF"].includes(modalityFilter)) {
    return Response.json({ error: "Некоректна модальність" }, { status: 400 });
  }

  const { results } = await db.prepare(
    `SELECT b.code, b.patient_id AS patientId,
       b.name AS patientName, b.date_of_birth AS patientBirthDate,
       b.service, b.service_code AS serviceCode, b.equipment_id AS equipmentId,
       b.desired_date AS scheduledDate, b.desired_time AS scheduledTime,
       COALESCE(i.accession_number, '') AS imagingAccession
     FROM bookings b
     LEFT JOIN imaging_studies i
       ON i.booking_id = b.id AND i.organization_id = b.organization_id
     WHERE b.organization_id = ?
       AND b.status IN ('scheduled','confirmed','rescheduled')
       AND b.desired_date BETWEEN ? AND ?
     ORDER BY b.desired_date, b.desired_time, b.id
     LIMIT 500`,
  ).bind(bridge.organizationId, from, to).all<FeedRow>();

  const patientIds = await patientIdsForRows(db, bridge.organizationId, results);
  const items: MwlFeedItem[] = results.map((row) => ({
    scheduledProcedureStepId: row.code,
    accessionNumber: canonicalWorklistAccession(row.code, row.imagingAccession),
    patientId: patientIds.get(mwlIdentityKey(row.patientId, row.code)) || "",
    patientName: row.patientName,
    patientBirthDate: row.patientBirthDate || "",
    modality: modalityForWorklist(row.serviceCode, row.equipmentId),
    scheduledDate: row.scheduledDate,
    scheduledTime: row.scheduledTime,
    procedureDescription: row.service,
    serviceCode: row.serviceCode,
    equipmentId: row.equipmentId,
  })).filter((item) => item.patientId && (!modalityFilter || item.modality === modalityFilter));

  await db.prepare(
    "UPDATE mwl_bridge_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE organization_id = ?",
  ).bind(bridge.organizationId).run().catch(() => undefined);

  return Response.json({
    organization: { id: bridge.organizationId, name: bridge.organizationName },
    period: { from, to },
    count: items.length,
    items,
  }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
