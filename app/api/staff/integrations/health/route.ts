import { dbBinding } from "../../../../../lib/db";
import { fetchLimited, safeOutboundUrl } from "../../../../../lib/outbound";
import { canManageSystem } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";

function probeUrl(base:string):URL | null {
  const normalized = base.trim().replace(/\/+$/, "");
  return normalized ? safeOutboundUrl(`${normalized}/studies?limit=1`) : null;
}

async function pacsReachable(base:string):Promise<boolean> {
  const url = probeUrl(base);
  if (!url) return false;
  try {
    const response = await fetchLimited(url, { headers:{ accept:"application/dicom+json" } }, 3000);
    return response.ok;
  } catch {
    return false;
  }
}

export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  if (!canManageSystem(ctx.member.role)) {
    return Response.json({ error:"Стан інтеграцій доступний лише системному адміністратору" }, { status:403 });
  }

  const [pacs, mwl] = await Promise.all([
    db.prepare(
      `SELECT dicomweb_base_url AS dicomwebBaseUrl, viewer_base_url AS viewerBaseUrl,
        ae_title AS aeTitle, enabled, updated_at AS updatedAt
       FROM pacs_settings WHERE organization_id = ? LIMIT 1`,
    ).bind(ctx.organizationId).first<Record<string, unknown>>(),
    db.prepare(
      `SELECT active, created_at AS createdAt, rotated_at AS rotatedAt, last_used_at AS lastUsedAt
       FROM mwl_bridge_tokens WHERE organization_id = ? LIMIT 1`,
    ).bind(ctx.organizationId).first<Record<string, unknown>>(),
  ]);

  const pacsConfigured = !!String(pacs?.dicomwebBaseUrl || "").trim();
  const pacsEnabled = !!Number(pacs?.enabled || 0);
  const reachable = pacsConfigured && pacsEnabled
    ? await pacsReachable(String(pacs?.dicomwebBaseUrl || ""))
    : false;
  const mwlConfigured = !!mwl;
  const mwlActive = !!Number(mwl?.active || 0);
  const lastUsedAt = String(mwl?.lastUsedAt || "");

  const pacsState = !pacsConfigured ? "not_configured" : !pacsEnabled ? "disabled" : reachable ? "operational" : "unreachable";
  const mwlState = !mwlConfigured ? "not_configured" : !mwlActive ? "disabled" : lastUsedAt ? "operational" : "awaiting_first_use";

  return Response.json({
    pacs:{
      state:pacsState,
      configured:pacsConfigured,
      enabled:pacsEnabled,
      reachable,
      viewerConfigured:!!String(pacs?.viewerBaseUrl || "").trim(),
      aeTitleConfigured:!!String(pacs?.aeTitle || "").trim(),
      updatedAt:String(pacs?.updatedAt || ""),
      autoLinkReady:pacsEnabled && reachable,
    },
    mwl:{
      state:mwlState,
      configured:mwlConfigured,
      active:mwlActive,
      createdAt:String(mwl?.createdAt || ""),
      rotatedAt:String(mwl?.rotatedAt || ""),
      lastUsedAt,
      ready:mwlActive,
    },
    overall: (pacsEnabled && reachable && mwlActive) ? "operational" : "attention_required",
  }, { headers:{ "cache-control":"no-store" } });
}
