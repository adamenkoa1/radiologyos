// Minimal iCalendar parser for reading an external Google Calendar feed.
// Extracts upcoming events (start time + title) for the staff dashboard.

export interface ExternalEvent {
  display: string;   // "10.08.2026 12:00" or "10.08.2026 · весь день"
  summary: string;
  sortMs: number;
  allDay: boolean;
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function formatKyiv(instant: Date): string {
  const parts = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
}

// Parse an ICS document; returns upcoming events sorted ascending, capped.
export function parseIcs(text: string, cutoffMs: number, limit = 60): ExternalEvent[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events: ExternalEvent[] = [];
  let inEvent = false;
  let start = "";
  let summary = "";

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { inEvent = true; start = ""; summary = ""; continue; }
    if (line === "END:VEVENT") {
      if (start) {
        const m = start.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
        if (m) {
          const [, Y, Mo, D, h, mi, s, z] = m;
          const y = +Y, mo = +Mo, d = +D;
          if (h === undefined) {
            const sortMs = Date.UTC(y, mo - 1, d);
            events.push({ allDay: true, summary: summary || "Подія", sortMs, display: `${pad(d)}.${pad(mo)}.${y} · весь день` });
          } else if (z) {
            const dt = new Date(Date.UTC(y, mo - 1, d, +h, +mi, s ? +s : 0));
            events.push({ allDay: false, summary: summary || "Подія", sortMs: dt.getTime(), display: formatKyiv(dt) });
          } else {
            const sortMs = Date.UTC(y, mo - 1, d, +h, +mi);
            events.push({ allDay: false, summary: summary || "Подія", sortMs, display: `${pad(d)}.${pad(mo)}.${y} ${pad(+h)}:${pad(+mi)}` });
          }
        }
      }
      inEvent = false; continue;
    }
    if (!inEvent) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).split(";")[0];
    const value = line.slice(idx + 1);
    if (name === "DTSTART") start = value.trim();
    else if (name === "SUMMARY") summary = unescapeText(value).slice(0, 200);
  }

  return events
    .filter((e) => e.sortMs >= cutoffMs)
    .sort((a, b) => a.sortMs - b.sortMs)
    .slice(0, limit);
}
