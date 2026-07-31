import { destroySession, requireStaff } from "../../../../lib/staff-auth";
import { clearedSessionCookie, readCookie, SESSION_COOKIE } from "../../../../lib/auth";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

export async function POST(request: Request) {
  const db = dbBinding();
  if (db) {
    // Резолвимо співробітника до знищення сесії, щоб журнал знав, хто вийшов.
    const member = await requireStaff(request, db).catch(() => null);
    if (member) await audit(db, { organizationId: 1, actorEmail: member.email, action: "logout", resource: "auth" });
    await destroySession(db, readCookie(request, SESSION_COOKIE));
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie(), "cache-control": "no-store" } });
}
