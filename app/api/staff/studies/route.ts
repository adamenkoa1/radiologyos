import { canManageBookings, type StaffRole } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";
import { listOrgClinicians, listOrgStudies } from "../../../../lib/tenant-repo";
import { STUDY_STATES, STUDY_STATE_LABELS, isTerminal, nextStates, stateLabel } from "../../../../lib/study-state";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

// Реєстр досліджень організації — tenant-scoped (organization_id зі серверної
// сесії) і machine-aware: кожен запис несе підпис поточного стану й перелік
// дозволених переходів згідно з єдиною state machine. Самі переходи виконує
// PATCH /api/staff/bookings (canTransition), тут — лише читання.
export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });

  const canManage = canManageBookings(ctx.role as StaffRole);
  const [rows, clinicians] = await Promise.all([
    listOrgStudies(db, ctx),
    canManage ? listOrgClinicians(db, ctx) : Promise.resolve([]),
  ]);
  const nameByEmail = new Map(clinicians.map((c) => [c.email, c.displayName || c.email]));

  const studies = rows.map((r) => ({
    ...r,
    stateLabel: stateLabel(r.status),
    terminal: isTerminal(r.status),
    radiologistName: r.assignedRadiologistEmail ? (nameByEmail.get(r.assignedRadiologistEmail) || r.assignedRadiologistEmail) : "",
    radiographerName: r.assignedRadiographerEmail ? (nameByEmail.get(r.assignedRadiographerEmail) || r.assignedRadiographerEmail) : "",
    // Дозволені наступні стани (лише для тих, хто веде заявки).
    nextStates: canManage
      ? nextStates(r.status).map((v) => ({ v, l: stateLabel(v) }))
      : [],
  }));

  // Лічильники за клінічними станами для черги/фільтрів.
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  return Response.json({
    organization: { id: ctx.organizationId, name: ctx.organizationName, slug: ctx.slug },
    role: ctx.role,
    canManage,
    states: STUDY_STATES.map((v) => ({ v, l: STUDY_STATE_LABELS[v], count: counts[v] ?? 0 })),
    // Виконавці для призначення: розділені за роллю (tenant-scoped).
    radiologists: clinicians.filter((c) => c.role === "radiologist").map((c) => ({ v: c.email, l: c.displayName || c.email })),
    radiographers: clinicians.filter((c) => c.role === "radiographer").map((c) => ({ v: c.email, l: c.displayName || c.email })),
    studies,
  });
}
