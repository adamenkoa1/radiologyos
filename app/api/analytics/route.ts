import { analyticsEventName, recordAnalyticsEvent } from "../../../lib/analytics";
import { dbBinding } from "../../../lib/db";

const CLIENT_EVENTS = new Set(["page_view", "service_view", "booking_started", "slot_selected"]);
const ALLOWED_KEYS = new Set(["eventName", "journeyId", "serviceCode", "patientCategory", "pageKey"]);
const MAX_BODY_BYTES = 2048;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return Response.json({ error: "Payload too large" }, { status: 413 });
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return Response.json({ error: "Unexpected analytics field" }, { status: 400 });
  }

  const eventName = analyticsEventName(body.eventName);
  if (!eventName || !CLIENT_EVENTS.has(eventName)) {
    return Response.json({ error: "Unsupported client analytics event" }, { status: 400 });
  }

  const journeyId = typeof body.journeyId === "string" ? body.journeyId : "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(journeyId)) {
    return Response.json({ error: "Invalid journey" }, { status: 400 });
  }

  const patientCategory = body.patientCategory === "civilian" || body.patientCategory === "military"
    ? body.patientCategory
    : "";

  await recordAnalyticsEvent(dbBinding(), {
    eventName,
    organizationId: 1,
    journeyId,
    serviceCode: typeof body.serviceCode === "string" ? body.serviceCode : "",
    patientCategory,
    pageKey: typeof body.pageKey === "string" ? body.pageKey : "",
    source: "client",
  });

  // Analytics is intentionally best-effort: collection failures never block UX.
  return new Response(null, { status: 204 });
}
