export type ClientAnalyticsEvent = "page_view" | "service_view" | "booking_started" | "slot_selected";

const JOURNEY_KEY = "radiologyos_analytics_journey_v1";

export function analyticsJourneyId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = sessionStorage.getItem(JOURNEY_KEY) || "";
    if (/^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const created = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(JOURNEY_KEY, created);
    return created;
  } catch {
    return "";
  }
}

export function trackClientAnalytics(
  eventName: ClientAnalyticsEvent,
  fields: { serviceCode?: string; patientCategory?: "civilian" | "military"; pageKey?: string } = {},
): void {
  const journeyId = analyticsJourneyId();
  if (!journeyId) return;
  void fetch("/api/analytics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventName,
      journeyId,
      serviceCode: fields.serviceCode || "",
      patientCategory: fields.patientCategory || "",
      pageKey: fields.pageKey || "",
    }),
    keepalive: true,
  }).catch(() => undefined);
}
