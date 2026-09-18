import { addMinutes, type Service } from "./catalog.ts";
import {
  candidateTimesFor,
  hoursFor,
  isEquipmentDayOpen,
  type ScheduleConfig,
} from "./schedule.ts";

export type BusyBooking = {
  equipmentId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
};

export type EquipmentBlock = {
  equipmentId: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type AutoAppointment = {
  serviceCode: string;
  service: string;
  equipmentId: string;
  durationMinutes: number;
  date: string;
  time: string;
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function overlaps(start: string, end: string, otherStart: string, otherEnd: string): boolean {
  return start < otherEnd && end > otherStart;
}

/**
 * Assigns the earliest free appointment to every selected service.
 * Reservations produced earlier in the same request are treated as busy, so
 * two services using the same room never receive overlapping slots.
 *
 * A patient-picked slot (preferredDate/preferredTime) is honoured as a soft
 * preference: the search starts from that date and the first service tries the
 * exact chosen time first. If nothing fits on/after the preferred date, the
 * whole plan falls back to the earliest availability from `fromDate`, so a
 * preference can never leave the patient without a slot.
 */
export function assignEarliestAppointments(input: {
  services: Service[];
  schedule: ScheduleConfig;
  bookings: BusyBooking[];
  blocks: EquipmentBlock[];
  fromDate: string;
  fromTime: string;
  preferredDate?: string;
  preferredTime?: string;
  searchDays?: number;
}): AutoAppointment[] | null {
  const searchDays = Math.max(1, Math.min(input.searchDays ?? 180, 180));
  const isIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(input.preferredDate || "");
  const isIsoTime = /^\d{2}:\d{2}$/.test(input.preferredTime || "");
  const preferredDate = isIsoDate && input.preferredDate! >= input.fromDate ? input.preferredDate! : "";
  const preferredTime = preferredDate && isIsoTime ? input.preferredTime! : "";

  // First pass honours the preference; on failure a second pass ignores it so
  // an unavailable preferred date never yields a false "no slots".
  const withPreference = preferredDate
    ? plan(input, searchDays, preferredDate, preferredTime)
    : null;
  if (withPreference) return withPreference;
  return plan(input, searchDays, input.fromDate, "");
}

function plan(
  input: {
    services: Service[];
    schedule: ScheduleConfig;
    bookings: BusyBooking[];
    blocks: EquipmentBlock[];
    fromDate: string;
    fromTime: string;
  },
  searchDays: number,
  searchStart: string,
  preferredTime: string,
): AutoAppointment[] | null {
  const reserved: BusyBooking[] = [];
  const appointments: AutoAppointment[] = [];

  input.services.forEach((service, serviceIndex) => {
    let selected: AutoAppointment | null = null;
    for (let offset = 0; offset <= searchDays && !selected; offset += 1) {
      const date = addDays(searchStart, offset);
      if (!isEquipmentDayOpen(date, input.schedule, service.equipmentId)) continue;

      let candidates = candidateTimesFor(hoursFor(input.schedule, service.equipmentId), service.durationMinutes);
      // The first service tries the patient's exact chosen time first (only if
      // it is a real slot start), then falls back to the earliest that day.
      if (serviceIndex === 0 && preferredTime && date === searchStart && candidates.includes(preferredTime)) {
        candidates = [preferredTime, ...candidates.filter((time) => time !== preferredTime)];
      }
      for (const time of candidates) {
        if (date === input.fromDate && time <= input.fromTime) continue;
        const end = addMinutes(time, service.durationMinutes);
        const bookingConflict = [...input.bookings, ...reserved].some((item) =>
          item.equipmentId === service.equipmentId && item.date === date
          && overlaps(time, end, item.startTime, addMinutes(item.startTime, item.durationMinutes))
        );
        const equipmentBlocked = input.blocks.some((item) =>
          item.equipmentId === service.equipmentId && item.date === date
          && overlaps(time, end, item.startTime, item.endTime)
        );
        if (bookingConflict || equipmentBlocked) continue;

        selected = {
          serviceCode: service.code,
          service: service.title,
          equipmentId: service.equipmentId,
          durationMinutes: service.durationMinutes,
          date,
          time,
        };
        reserved.push({
          equipmentId: service.equipmentId,
          date,
          startTime: time,
          durationMinutes: service.durationMinutes,
        });
        break;
      }
    }
    if (selected) appointments.push(selected);
  });

  return appointments.length === input.services.length ? appointments : null;
}
