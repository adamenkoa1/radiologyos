// Builds an iCalendar (ICS) feed of appointments for a Google Calendar
// subscription. Times are Kyiv-local; a booking without a time becomes an
// all-day event.

export interface CalendarBooking {
  code: string;
  service: string;
  desiredDate: string;   // YYYY-MM-DD
  desiredTime: string;   // HH:MM or ""
  durationMinutes: number;
  status: string;
}

const STATUS_MAP: Record<string, string> = {
  new: "TENTATIVE", confirmed: "CONFIRMED", rescheduled: "CONFIRMED",
};

function esc(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function addMinutesLocal(date: string, time: string, minutes: number): { date: string; time: string } {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const base = Date.UTC(y, m - 1, d, hh, mm) + minutes * 60000;
  const dt = new Date(base);
  return {
    date: `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`,
    time: `${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`,
  };
}

function stamp(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function buildIcs(bookings: CalendarBooking[]): string {
  const now = stamp();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RadiologyOS//UA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:RadiologyOS — записи",
    "X-WR-TIMEZONE:Europe/Kyiv",
  ];
  for (const b of bookings) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.desiredDate)) continue;
    const ymd = b.desiredDate.replace(/-/g, "");
    const summary = esc(b.service);
    const description = esc(`Код запису: ${b.code}\nСтатус: ${b.status}`);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${esc(b.code)}@radiologyos.tech`);
    lines.push(`DTSTAMP:${now}`);
    if (/^\d{2}:\d{2}$/.test(b.desiredTime)) {
      const startTime = `${b.desiredTime.replace(":", "")}00`;
      const end = addMinutesLocal(b.desiredDate, b.desiredTime, b.durationMinutes || 30);
      lines.push(`DTSTART;TZID=Europe/Kyiv:${ymd}T${startTime}`);
      lines.push(`DTEND;TZID=Europe/Kyiv:${end.date}T${end.time}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${ymd}`);
    }
    lines.push(`SUMMARY:${summary}`);
    lines.push(`DESCRIPTION:${description}`);
    lines.push(`STATUS:${STATUS_MAP[b.status] || "TENTATIVE"}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
