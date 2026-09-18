// Generates (or rotates) the private calendar subscription token. Admin only.
// Rotating it invalidates any previously shared subscription link.

import { requireOrgContext } from "../../../../../lib/tenant";
import { setSetting } from "../../../../../lib/settings";
import { hashToken } from "../../../../../lib/auth";
import { dbBinding } from "../../../../../lib/db";

const tokenKey = (organizationId: number) => `calendar_token_hash:org:${organizationId}`;

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  if (member.role !== "admin") return Response.json({ error: "Доступно лише адміністратору" }, { status: 403 });

  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await hashToken(token);
  await setSetting(db, tokenKey(ctx.organizationId), tokenHash);
  if (ctx.organizationId === 1) {
    await setSetting(db, "calendar_token_hash", await hashToken(token));
  }
  const calendarToken = ctx.organizationId === 1 ? token : `${ctx.organizationId}.${token}`;
  return Response.json({ ok: true, calendarToken });
}
