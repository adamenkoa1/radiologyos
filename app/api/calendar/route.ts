// Private iCal feed of appointments for a Google Calendar subscription.
// Access is gated by a one-time-disclosed token. The database stores only its
// hash, and the feed itself contains no direct patient identifiers.

import { getSetting } from "../../../lib/settings";
import { buildIcs, type CalendarBooking } from "../../../lib/calendar-ics";
import { hashToken } from "../../../lib/auth";
import { publicTenant } from "../../../lib/tenant";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return new Response("Service unavailable", { status: 503 });
  const tenant = publicTenant();

  const token = new URL(request.url).searchParams.get("token") || "";
  const expected = await getSetting(db, "calendar_token_hash", tenant.organizationId);
  if (!expected || !token || await hashToken(token) !== expected) {
    return new Response("Not found", { status: 404 });
  }

  const rows = await db.prepare(
    `SELECT code, service, desired_date AS desiredDate, desired_time AS desiredTime,
       duration_minutes AS durationMinutes, status
     FROM bookings
     WHERE organization_id = ?
       AND status IN ('new','confirmed','rescheduled')
       AND desired_date >= date('now','-1 day')
     ORDER BY desired_date, desired_time
     LIMIT 1000`
  ).bind(tenant.organizationId).all<CalendarBooking>();

  const ics = buildIcs(rows.results || []);
  return new Response(ics, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="radiologyos.ics"',
      "cache-control": "no-store",
    },
  });
}
