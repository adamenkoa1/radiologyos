import { canViewReports } from "../../../../lib/staff-auth";
import { dbBinding } from "../../../../lib/db";
import { requireOrgContext } from "../../../../lib/tenant";
import { ANALYTICS_EVENTS } from "../../../../lib/analytics";

function isoDate(value: string | null, fallback: string): string | undefined {
  const candidate = value || fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : undefined;
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canViewReports(ctx.member.role)) {
    return Response.json({ error: "Аналітика доступна лише адміністратору" }, { status: 403 });
  }

  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const from = isoDate(url.searchParams.get("from"), monthAgo);
  const to = isoDate(url.searchParams.get("to"), today);
  if (!from || !to || from > to) {
    return Response.json({ error: "Некоректний період" }, { status: 400 });
  }

  const { results } = await db.prepare(
    `SELECT event_name AS eventName,
            COUNT(*) AS events,
            COUNT(DISTINCT CASE WHEN journey_id != '' THEN journey_id END) AS journeys
       FROM analytics_events
      WHERE organization_id = ?
        AND date(occurred_at) BETWEEN ? AND ?
      GROUP BY event_name`,
  ).bind(ctx.organizationId, from, to).all<{ eventName: string; events: number; journeys: number }>();

  const counts = new Map(results.map(row => [row.eventName, {
    events: Number(row.events || 0),
    journeys: Number(row.journeys || 0),
  }]));
  const funnel = ANALYTICS_EVENTS.map(eventName => ({
    eventName,
    events: counts.get(eventName)?.events || 0,
    journeys: counts.get(eventName)?.journeys || 0,
  }));

  const { results: services } = await db.prepare(
    `SELECT service_code AS serviceCode, event_name AS eventName, COUNT(*) AS events
       FROM analytics_events
      WHERE organization_id = ?
        AND service_code != ''
        AND date(occurred_at) BETWEEN ? AND ?
      GROUP BY service_code, event_name
      ORDER BY events DESC
      LIMIT 100`,
  ).bind(ctx.organizationId, from, to).all<{ serviceCode: string; eventName: string; events: number }>();

  return Response.json({
    period: { from, to },
    funnel,
    services: services.map(row => ({
      serviceCode: row.serviceCode,
      eventName: row.eventName,
      events: Number(row.events || 0),
    })),
  }, { headers: { "cache-control": "no-store" } });
}
