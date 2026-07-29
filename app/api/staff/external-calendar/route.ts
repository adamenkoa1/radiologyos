// Reads the configured external Google Calendar (iCal URL) server-side and
// returns upcoming events for the staff dashboard. Staff-only.

import { canAccessAllBookings, requireStaff } from "../../../../lib/staff-auth";
import { getSetting } from "../../../../lib/settings";
import { parseIcs } from "../../../../lib/ics-parse";
import { fetchLimited, readLimitedText, safeOutboundUrl } from "../../../../lib/outbound";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canAccessAllBookings(member.role)) {
    return Response.json({ error: "Календар доступний лише реєстратору або адміністратору" }, { status: 403 });
  }

  const url = await getSetting(db, "external_ics_url", member.organizationId);
  if (!url) return Response.json({ configured: false, events: [] }, { headers: { "cache-control": "no-store" } });
  const safeUrl = safeOutboundUrl(url);
  if (!safeUrl) {
    return Response.json({
      configured: true,
      events: [],
      error: "Адресу календаря заблоковано політикою вихідних з’єднань",
    });
  }

  try {
    const response = await fetchLimited(safeUrl, { cf: { cacheTtl: 300 } } as RequestInit, 5000);
    if (!response.ok) return Response.json({ configured: true, events: [], error: "Не вдалося завантажити календар" });
    const text = await readLimitedText(response);
    const events = parseIcs(text, Date.now() - 12 * 60 * 60 * 1000, 40);
    return Response.json({ configured: true, events }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ configured: true, events: [], error: "Не вдалося завантажити календар" });
  }
}
