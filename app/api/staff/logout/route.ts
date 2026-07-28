import { destroySession } from "../../../../lib/staff-auth";
import { clearedSessionCookie, readCookie, SESSION_COOKIE } from "../../../../lib/auth";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (db) await destroySession(db, readCookie(request, SESSION_COOKIE));
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie(), "cache-control": "no-store" } });
}
