export const ANALYTICS_EVENTS = [
  "page_view",
  "service_view",
  "booking_started",
  "slot_selected",
  "booking_created",
  "payment_started",
  "payment_completed",
  "patient_arrived",
  "study_completed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];
export type AnalyticsPatientCategory = "" | "civilian" | "military";
export type AnalyticsSource = "client" | "server";

export type AnalyticsEventInput = {
  eventName: AnalyticsEventName;
  organizationId?: number;
  journeyId?: string;
  serviceCode?: string;
  patientCategory?: AnalyticsPatientCategory;
  pageKey?: string;
  source?: AnalyticsSource;
};

const EVENT_SET = new Set<string>(ANALYTICS_EVENTS);

function boundedToken(value: unknown, max: number, pattern: RegExp): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, max);
  return pattern.test(trimmed) ? trimmed : "";
}

export function analyticsEventName(value: unknown): AnalyticsEventName | undefined {
  return typeof value === "string" && EVENT_SET.has(value)
    ? value as AnalyticsEventName
    : undefined;
}

export function sanitizeAnalyticsInput(input: AnalyticsEventInput): Required<AnalyticsEventInput> {
  const eventName = analyticsEventName(input.eventName);
  if (!eventName) throw new Error("Unknown analytics event");
  const patientCategory = input.patientCategory === "civilian" || input.patientCategory === "military"
    ? input.patientCategory
    : "";
  return {
    eventName,
    organizationId: Number.isInteger(input.organizationId) && Number(input.organizationId) > 0
      ? Number(input.organizationId)
      : 1,
    journeyId: boundedToken(input.journeyId, 64, /^[A-Za-z0-9_-]*$/),
    serviceCode: boundedToken(input.serviceCode, 16, /^[A-Za-z0-9_-]*$/),
    patientCategory,
    pageKey: boundedToken(input.pageKey, 64, /^[A-Za-z0-9_/-]*$/),
    source: input.source === "client" ? "client" : "server",
  };
}

/**
 * Best-effort analytics recorder. Core clinical/payment flows must never fail
 * because analytics storage is unavailable.
 */
export async function recordAnalyticsEvent(
  db: D1Database | null | undefined,
  input: AnalyticsEventInput,
): Promise<boolean> {
  if (!db) return false;
  try {
    const event = sanitizeAnalyticsInput(input);
    await db.prepare(
      `INSERT INTO analytics_events
        (organization_id, event_name, journey_id, service_code, patient_category, page_key, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      event.organizationId,
      event.eventName,
      event.journeyId,
      event.serviceCode,
      event.patientCategory,
      event.pageKey,
      event.source,
    ).run();
    return true;
  } catch {
    return false;
  }
}
