// Generates (or rotates) the private calendar subscription token. Admin only.
// Rotating it invalidates any previously shared subscription link.

import { requireStaff } from "../../../../../lib/staff-auth";
import { setSetting } from "../../../../../lib/settings";
import { hashToken } from "../../../../../lib/auth";
import { dbBinding } from "../../../../../lib/db";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Доступно лише адміністратору" }, { status: 403 });

  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  await setSetting(db, "calendar_token_hash", await hashToken(token));
  return Response.json({ ok: true, calendarToken: token });
}
