import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Drizzle representation of possession-based patient authentication added by
// migration 0028. The legacy core schema keeps the original patientSessions
// export for compatibility; this scoped model is the authoritative v2 shape.
export const patientSessionsScoped = sqliteTable("patient_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  phoneNormalized: text("phone_normalized").notNull(),
  organizationId: integer("organization_id").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, table => [
  index("patient_sessions_org_phone_idx").on(table.organizationId, table.phoneNormalized, table.expiresAt),
]);

export const patientOtpChallenges = sqliteTable("patient_otp_challenges", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").notNull().default(1),
  phoneNormalized: text("phone_normalized").notNull(),
  purpose: text("purpose").notNull().default("cabinet_login"),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at").notNull().default(""),
}, table => [
  index("patient_otp_phone_idx").on(table.organizationId, table.phoneNormalized, table.createdAt),
  index("patient_otp_expiry_idx").on(table.expiresAt, table.consumedAt),
]);
