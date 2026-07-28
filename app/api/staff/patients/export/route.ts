// Export patients as a Google Contacts CSV (name + phone), ready for
// contacts.google.com → Import. Excludes "do not contact" patients.

import { requireStaff } from "../../../../../lib/staff-auth";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

function csvCell(value: string): string {
  const v = String(value ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });

  // Latest booking per phone gives the freshest name; the profile name wins if set.
  const rows = await db.prepare(
    `SELECT b.phone_normalized AS phone,
       COALESCE(NULLIF(p.display_name, ''), b.name) AS name
     FROM bookings b
     JOIN (SELECT phone_normalized, MAX(id) AS mid FROM bookings
           WHERE phone_normalized != '' GROUP BY phone_normalized) last ON last.mid = b.id
     LEFT JOIN patient_profiles p ON p.phone_normalized = b.phone_normalized
     WHERE COALESCE(p.do_not_contact, 0) = 0
     ORDER BY name`
  ).all<{ phone: string; name: string }>();

  const header = "Name,Phone 1 - Type,Phone 1 - Value,Notes";
  const lines = (rows.results || []).map((r) => {
    const phone = r.phone ? `+${r.phone}` : "";
    return [csvCell(r.name || "Пацієнт"), "Mobile", csvCell(phone), "RadiologyOS"].join(",");
  });
  const csv = "﻿" + [header, ...lines].join("\r\n") + "\r\n";

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="radiologyos-contacts.csv"',
      "cache-control": "no-store",
    },
  });
}
