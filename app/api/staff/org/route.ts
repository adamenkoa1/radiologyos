import { requireOrgContext } from "../../../../lib/tenant";
import { countOrgBookings, listOrgDepartments } from "../../../../lib/tenant-repo";
import { dbBinding } from "../../../../lib/db";

// Повертає організацію активного співробітника разом із базовими tenant-даними.
// organizationId походить лише із серверної сесії (див. requireOrgContext) —
// клієнт не може його підмінити.
export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });

  const [departments, bookingsCount] = await Promise.all([
    listOrgDepartments(db, ctx),
    countOrgBookings(db, ctx),
  ]);

  return Response.json({
    organization: {
      id: ctx.organizationId,
      slug: ctx.slug,
      name: ctx.organizationName,
    },
    role: ctx.role,
    member: { email: ctx.member.email, displayName: ctx.member.displayName },
    departments,
    bookingsCount,
  });
}
