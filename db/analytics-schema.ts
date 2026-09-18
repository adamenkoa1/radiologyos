import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const analyticsEvents = sqliteTable("analytics_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").notNull().default(1),
  eventName: text("event_name").notNull(),
  journeyId: text("journey_id").notNull().default(""),
  serviceCode: text("service_code").notNull().default(""),
  patientCategory: text("patient_category").notNull().default(""),
  pageKey: text("page_key").notNull().default(""),
  source: text("source").notNull().default("server"),
  occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("analytics_events_org_time_idx").on(table.organizationId, table.occurredAt),
  index("analytics_events_org_event_time_idx").on(table.organizationId, table.eventName, table.occurredAt),
  index("analytics_events_journey_idx").on(table.organizationId, table.journeyId, table.occurredAt),
]);
