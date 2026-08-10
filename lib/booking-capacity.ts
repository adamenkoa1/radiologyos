export type CapacitySlot = {
  organizationId: number;
  equipmentId: string;
  date: string;
  minute: string;
  bookingCode: string;
};

function parseMinute(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid appointment time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid appointment time: ${value}`);
  }
  return hour * 60 + minute;
}

function formatMinute(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Returns every occupied minute in the half-open interval [start, end).
 * Adjacent appointments therefore never share a key: 08:30-09:00 occupies
 * through 08:59 and a 09:00 appointment starts at a different key.
 */
export function occupiedMinutes(startTime: string, durationMinutes: number): string[] {
  const start = parseMinute(startTime);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 24 * 60) {
    throw new Error(`Invalid appointment duration: ${durationMinutes}`);
  }
  if (start + durationMinutes > 24 * 60) {
    throw new Error("Appointment crosses midnight");
  }
  return Array.from({ length: durationMinutes }, (_, offset) => formatMinute(start + offset));
}

export function capacitySlots(input: {
  organizationId: number;
  equipmentId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  bookingCode: string;
}): CapacitySlot[] {
  return occupiedMinutes(input.startTime, input.durationMinutes).map((minute) => ({
    organizationId: input.organizationId,
    equipmentId: input.equipmentId,
    date: input.date,
    minute,
    bookingCode: input.bookingCode,
  }));
}

/** D1/SQLite uniqueness violation produced by booking_capacity_locks. */
export function isCapacityConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("UNIQUE constraint failed")
    && message.includes("booking_capacity_locks");
}
