// Export patients as a Google Contacts CSV (name + phone), ready for
// contacts.google.com → Import. Excludes "do not contact" patients.

import { logSecurityEvent } from "../../../../../lib/audit";
import { canExportPatientData } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";
import { dbBinding } from "../../../../../lib/db";

function csvCell(value: string, neutralizeFormula = false): string {
  let v = String(value ?? "");
  if (neutralizeFormula && /^[=+\-@]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (!canExportPatientData(member.role)) {
    return Response.json({ error: "Експорт персональних даних доступний лише адміністратору" }, { status: 403 });
  }

  // Latest booking per phone gives the freshest name; the profile name wins if set.
  // Обмежено організацією контексту (tenant-isolation).
  const rows = await db.prepare(
    `SELECT b.phone_normalized AS phone,
       COALESCE(NULLIF(p.display_name, ''), b.name) AS name
     FROM bookings b
     JOIN (SELECT phone_normalized, MAX(id) AS mid FROM bookings
           WHERE phone_normalized != '' AND organization_id = ?1 GROUP BY phone_normalized) last ON last.mid = b.id
     LEFT JOIN patient_profiles p ON p.phone_normalized = b.phone_normalized AND p.organization_id = ?1
     WHERE b.organization_id = ?1 AND COALESCE(p.do_not_contact, 0) = 0
     ORDER BY name`
  ).bind(ctx.organizationId).all<{ phone: string; name: string }>();

  const header = "Name,Phone 1 - Type,Phone 1 - Value,Notes";
  const lines = (rows.results || []).map((r) => {
    const phone = r.phone ? `+${r.phone}` : "";
    return [csvCell(r.name || "Пацієнт", true), "Mobile", csvCell(phone), "RadiologyOS"].join(",");
  });
  const csv = "﻿" + [header, ...lines].join("\r\n") + "\r\n";

  await logSecurityEvent(db, {
    actorEmail: member.email,
    action: "patient_contacts_exported",
    resource: "patient_registry",
    details: { format: "csv", rows: lines.length },
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="radiologyos-contacts.csv"',
      "cache-control": "no-store",
    },
  });
}
