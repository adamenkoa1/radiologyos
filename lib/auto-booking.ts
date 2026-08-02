import { addMinutes, type Service } from "./catalog";
import {
  candidateTimesFor,
  hoursFor,
  isDayOpen,
  isEquipmentDayOpen,
  type ScheduleConfig,
} from "./schedule";

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
 */
export function assignEarliestAppointments(input: {
  services: Service[];
  schedule: ScheduleConfig;
  bookings: BusyBooking[];
  blocks: EquipmentBlock[];
  fromDate: string;
  fromTime: string;
  searchDays?: number;
}): AutoAppointment[] | null {
  const reserved: BusyBooking[] = [];
  const appointments: AutoAppointment[] = [];
  const searchDays = Math.max(1, Math.min(input.searchDays ?? 180, 180));

  for (const service of input.services) {
    let selected: AutoAppointment | null = null;
    for (let offset = 0; offset <= searchDays && !selected; offset += 1) {
      const date = addDays(input.fromDate, offset);
      if (!isDayOpen(date, input.schedule) || !isEquipmentDayOpen(date, input.schedule, service.equipmentId)) continue;

      const candidates = candidateTimesFor(hoursFor(input.schedule, service.equipmentId), service.durationMinutes);
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
    if (!selected) return null;
    appointments.push(selected);
  }

  return appointments;
}
