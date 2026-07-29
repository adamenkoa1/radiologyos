import { addMinutes, candidateTimes, EQUIPMENT, serviceByCode } from "../../../lib/catalog";
import { isBookableDate } from "../../../lib/booking-rules";
import { publicTenant } from "../../../lib/tenant";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "";
  const service = serviceByCode(url.searchParams.get("serviceCode") || "");
  if (!isBookableDate(date) || !service) return Response.json({ times: [] });
  const db = (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  const tenant = publicTenant();

  const [bookings, blocks] = await Promise.all([
    db.prepare(
      `SELECT desired_time AS startTime, duration_minutes AS durationMinutes
       FROM bookings
       WHERE organization_id = ? AND equipment_id = ? AND desired_date = ?
       AND status IN ('confirmed','rescheduled')`
    ).bind(
      tenant.organizationId,
      service.equipmentId,
      date,
    ).all<{startTime:string;durationMinutes:number}>(),
    db.prepare(
      `SELECT start_time AS startTime, end_time AS endTime FROM equipment_blocks
       WHERE organization_id = ? AND equipment_id = ? AND blocked_date = ?`
    ).bind(
      tenant.organizationId,
      service.equipmentId,
      date,
    ).all<{startTime:string;endTime:string}>(),
  ]);

  const overlaps = (start:string, end:string, otherStart:string, otherEnd:string) =>
    start < otherEnd && end > otherStart;
  const times = candidateTimes(service).filter(start => {
    const end = addMinutes(start, service.durationMinutes);
    const bookingConflict = bookings.results.some((row:{startTime:string;durationMinutes:number}) =>
      overlaps(start, end, row.startTime, addMinutes(row.startTime, row.durationMinutes)));
    const blocked = blocks.results.some((row:{startTime:string;endTime:string}) =>
      overlaps(start, end, row.startTime, row.endTime));
    return !bookingConflict && !blocked;
  });
  return Response.json({
    times,
    durationMinutes: service.durationMinutes,
    equipment: EQUIPMENT[service.equipmentId].name,
  });
}
