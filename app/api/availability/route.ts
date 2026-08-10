import { addMinutes, EQUIPMENT } from "../../../lib/catalog";
import { isBookableDate } from "../../../lib/booking-rules";
import { effectiveServiceByCode } from "../../../lib/effective-services";
import { getSetting } from "../../../lib/settings";
import { candidateTimesFor, hoursFor, isEquipmentDayOpen, parseSchedule, SCHEDULE_KEY } from "../../../lib/schedule";
import { requireOrgContext } from "../../../lib/tenant";
import { dbBinding } from "../../../lib/db";

const PUBLIC_ORGANIZATION_ID = 1;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "";
  const serviceCode = url.searchParams.get("serviceCode") || "";
  if (!isBookableDate(date)) return Response.json({ times: [] });

  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });

  // Staff requests inherit the organization exclusively from the verified
  // server-side session. Anonymous storefront requests stay on the initial
  // public organization until host/slug tenant routing is introduced.
  const staffContext = await requireOrgContext(request, db);
  const organizationId = staffContext?.organizationId ?? PUBLIC_ORGANIZATION_ID;

  const service = await effectiveServiceByCode(db, serviceCode, organizationId);
  if (!service || !service.active || (!service.civilian && !service.military)) {
    return Response.json({ times: [] });
  }

  const schedule = parseSchedule(await getSetting(db, SCHEDULE_KEY));
  if (!isEquipmentDayOpen(date, schedule, service.equipmentId)) {
    return Response.json({
      times: [],
      durationMinutes: service.durationMinutes,
      equipment: EQUIPMENT[service.equipmentId].name,
      price: service.price,
    });
  }

  const [bookings, blocks] = await Promise.all([
    db.prepare(
      `SELECT desired_time AS startTime, duration_minutes AS durationMinutes
       FROM bookings WHERE organization_id = ? AND equipment_id = ? AND desired_date = ?
       AND status IN ('new','confirmed','rescheduled')`
    ).bind(organizationId, service.equipmentId, date).all<{startTime:string;durationMinutes:number}>(),
    db.prepare(
      `SELECT start_time AS startTime, end_time AS endTime FROM equipment_blocks
       WHERE organization_id = ? AND equipment_id = ? AND blocked_date = ?`
    ).bind(organizationId, service.equipmentId, date).all<{startTime:string;endTime:string}>(),
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
    price: service.price,
  });
}
