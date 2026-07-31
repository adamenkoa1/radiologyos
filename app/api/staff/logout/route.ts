import { destroySession } from "../../../../lib/staff-auth";
import { clearedSessionCookie, readCookie, SESSION_COOKIE } from "../../../../lib/auth";
import { dbBinding } from "../../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (db) await destroySession(db, readCookie(request, SESSION_COOKIE));
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie(), "cache-control": "no-store" } });
}
