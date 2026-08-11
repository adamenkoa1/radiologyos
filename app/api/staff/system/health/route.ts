import { dbBinding } from "../../../../../lib/db";
import { requireOrgContext } from "../../../../../lib/tenant";

type Check = { state:"operational" | "attention_required"; detail:string };

async function probe(db: ReturnType<typeof dbBinding>, sql:string, ...bind:unknown[]):Promise<boolean> {
  if (!db) return false;
  try {
    await db.prepare(sql).bind(...bind).first();
    return true;
  } catch {
    return false;
  }
}

export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });

  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  if (ctx.member.role !== "admin") {
    return Response.json({ error:"Стан системи доступний лише адміністратору" }, { status:403 });
  }

  const orgId = ctx.organizationId;
  const [databaseOk, bookingsOk, paymentsOk, pacs, mwl] = await Promise.all([
    probe(db, "SELECT 1 AS ok"),
    probe(db, "SELECT organization_id FROM bookings WHERE organization_id = ? LIMIT 1", orgId),
    probe(db, "SELECT organization_id FROM payment_transactions WHERE organization_id = ? LIMIT 1", orgId),
    db.prepare(
      `SELECT enabled, dicomweb_base_url AS dicomwebBaseUrl
       FROM pacs_settings WHERE organization_id = ? LIMIT 1`,
    ).bind(orgId).first<Record<string, unknown>>().catch(() => null),
    db.prepare(
      `SELECT active, last_used_at AS lastUsedAt
       FROM mwl_bridge_tokens WHERE organization_id = ? LIMIT 1`,
    ).bind(orgId).first<Record<string, unknown>>().catch(() => null),
  ]);

  const pacsConfigured = !!String(pacs?.dicomwebBaseUrl || "").trim();
  const pacsEnabled = !!Number(pacs?.enabled || 0);
  const mwlConfigured = !!mwl;
  const mwlActive = !!Number(mwl?.active || 0);

  const checks:Record<string, Check> = {
    database:{
      state:databaseOk ? "operational":"attention_required",
      detail:databaseOk ? "D1 відповідає на read-only запит":"D1 read probe не пройдено",
    },
    authentication:{
      state:"operational",
      detail:"Staff session та tenant context визначено",
    },
    bookings:{
      state:bookingsOk ? "operational":"attention_required",
      detail:bookingsOk ? "Booking schema доступна":"Booking schema недоступна",
    },
    payments:{
      state:paymentsOk ? "operational":"attention_required",
      detail:paymentsOk ? "Payment ledger schema доступна":"Payment ledger schema недоступна",
    },
    imaging:{
      state:(pacsConfigured && pacsEnabled && mwlActive) ? "operational":"attention_required",
      detail:(pacsConfigured && pacsEnabled && mwlActive)
        ? "PACS налаштований, MWL token активний"
        : "Перевірте конфігурацію PACS/MWL у спеціалізованому health-екрані",
    },
  };

  const overall = Object.values(checks).every((check)=>check.state === "operational")
    ? "operational"
    : "attention_required";

  return Response.json({
    overall,
    checkedAt:new Date().toISOString(),
    checks,
    imaging:{
      pacsConfigured,
      pacsEnabled,
      mwlConfigured,
      mwlActive,
      mwlUsed:!!String(mwl?.lastUsedAt || ""),
    },
  }, { headers:{ "cache-control":"no-store" } });
}
