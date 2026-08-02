import { addMinutes, EQUIPMENT, serviceByCode } from "../../../lib/catalog";
import { isBookableDate } from "../../../lib/booking-rules";
import { getSetting } from "../../../lib/settings";
import { candidateTimesFor, hoursFor, isDayOpen, isEquipmentDayOpen, parseSchedule, SCHEDULE_KEY } from "../../../lib/schedule";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "";
  const service = serviceByCode(url.searchParams.get("serviceCode") || "");
  if (!isBookableDate(date) || !service) return Response.json({ times: [] });
  const db = (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  // Налаштовуваний графік: робочі дні й години прийому.
  const schedule = parseSchedule(await getSetting(db, SCHEDULE_KEY));
  if (!isDayOpen(date, schedule) || !isEquipmentDayOpen(date, schedule, service.equipmentId)) return Response.json({ times: [], durationMinutes: service.durationMinutes, equipment: EQUIPMENT[service.equipmentId].name });

  const [bookings, blocks] = await Promise.all([
    db.prepare(
      `SELECT desired_time AS startTime, duration_minutes AS durationMinutes
       FROM bookings WHERE equipment_id = ? AND desired_date = ?
       AND status IN ('confirmed','rescheduled')`
    ).bind(service.equipmentId, date).all<{startTime:string;durationMinutes:number}>(),
    db.prepare(
      `SELECT start_time AS startTime, end_time AS endTime FROM equipment_blocks
       WHERE equipment_id = ? AND blocked_date = ?`
    ).bind(service.equipmentId, date).all<{startTime:string;endTime:string}>(),
  ]);

  const overlaps = (start:string, end:string, otherStart:string, otherEnd:string) =>
    start < otherEnd && end > otherStart;
  const times = candidateTimesFor(hoursFor(schedule, service.equipmentId), service.durationMinutes).filter(start => {
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
