// Export patients as a Google Contacts CSV (name + phone), ready for
// contacts.google.com → Import. Excludes exact "do not contact" profiles.

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

  // Exact CRM profiles are separate contacts even when they share a phone.
  // Historical unlinked bookings are exported only when no profile at all uses
  // that phone, so a legacy phone row can never collapse/override exact people.
  const rows = await db.prepare(
    `SELECT phone_normalized AS phone,
       COALESCE(NULLIF(display_name, ''), 'Пацієнт') AS name
     FROM patient_profiles
     WHERE organization_id = ?1 AND phone_normalized != '' AND do_not_contact = 0
     UNION ALL
     SELECT b.phone_normalized AS phone, b.name AS name
     FROM bookings b
     JOIN (
       SELECT phone_normalized, MAX(id) AS mid
       FROM bookings
       WHERE organization_id = ?1 AND patient_id = '' AND phone_normalized != ''
       GROUP BY phone_normalized
     ) last ON last.mid = b.id
     WHERE b.organization_id = ?1
       AND NOT EXISTS (
         SELECT 1 FROM patient_profiles p
         WHERE p.organization_id = ?1 AND p.phone_normalized = b.phone_normalized
       )
     ORDER BY name`
  ).bind(ctx.organizationId).all<{ phone: string; name: string }>();

  const header = "Name,Phone 1 - Type,Phone 1 - Value,Notes";
  const lines = (rows.results || []).map((r) => {
    const phone = r.phone ? `+${r.phone}` : "";
    return [csvCell(r.name || "Пацієнт", true), "Mobile", csvCell(phone), "RadiologyOS"].join(",");
  });
  const csv = "﻿" + [header, ...lines].join("\r\n") + "\r\n";

  await logSecurityEvent(db, {
    organizationId: ctx.organizationId,
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
