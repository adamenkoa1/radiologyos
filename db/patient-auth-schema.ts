import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Drizzle representation of possession-based patient authentication added by
// migration 0028, identity-scoped by migration 0046, and optionally anchored
// to immutable patient_id by migration 0053. The legacy core schema keeps the
// original patientSessions export for compatibility; this scoped model is the
// authoritative patient-auth shape.
export const patientSessionsScoped = sqliteTable("patient_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  phoneNormalized: text("phone_normalized").notNull(),
  organizationId: integer("organization_id").notNull().default(1),
  identityKind: text("identity_kind").notNull().default(""),
  identityValue: text("identity_value").notNull().default(""),
  patientId: text("patient_id").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, table => [
  index("patient_sessions_org_phone_idx").on(table.organizationId, table.phoneNormalized, table.expiresAt),
  index("patient_sessions_identity_scope_idx").on(
    table.organizationId, table.phoneNormalized, table.identityKind, table.identityValue, table.expiresAt,
  ),
  index("patient_sessions_patient_idx").on(table.organizationId, table.patientId, table.expiresAt),
]);

export const patientOtpChallenges = sqliteTable("patient_otp_challenges", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").notNull().default(1),
  phoneNormalized: text("phone_normalized").notNull(),
  identityKind: text("identity_kind").notNull().default(""),
  identityValue: text("identity_value").notNull().default(""),
  patientId: text("patient_id").notNull().default(""),
  purpose: text("purpose").notNull().default("cabinet_login"),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at").notNull().default(""),
}, table => [
  index("patient_otp_phone_idx").on(table.organizationId, table.phoneNormalized, table.createdAt),
  index("patient_otp_expiry_idx").on(table.expiresAt, table.consumedAt),
  index("patient_otp_identity_scope_idx").on(
    table.organizationId, table.phoneNormalized, table.identityKind, table.identityValue, table.createdAt,
  ),
  index("patient_otp_patient_idx").on(table.organizationId, table.patientId, table.createdAt),
]);

export const telegramLinkTokensScoped = sqliteTable("telegram_link_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  organizationId: integer("organization_id").notNull().default(1),
  phoneNormalized: text("phone_normalized").notNull(),
  identityKind: text("identity_kind").notNull().default(""),
  identityValue: text("identity_value").notNull().default(""),
  patientId: text("patient_id").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, table => [
  index("telegram_link_tokens_org_phone_idx").on(table.organizationId, table.phoneNormalized),
  index("telegram_link_tokens_identity_scope_idx").on(
    table.organizationId, table.phoneNormalized, table.identityKind, table.identityValue, table.expiresAt,
  ),
  index("telegram_link_tokens_patient_idx").on(table.organizationId, table.patientId, table.expiresAt),
]);

export const patientTelegramIdentities = sqliteTable("patient_telegram_identities", {
  organizationId: integer("organization_id").notNull(),
  phoneNormalized: text("phone_normalized").notNull(),
  identityKind: text("identity_kind").notNull(),
  identityValue: text("identity_value").notNull(),
  patientId: text("patient_id").notNull().default(""),
  telegramChatId: text("telegram_chat_id").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  primaryKey({ columns:[table.organizationId, table.phoneNormalized, table.identityKind, table.identityValue] }),
  index("patient_telegram_chat_idx").on(table.telegramChatId).where(sql`telegram_chat_id != ''`),
  index("patient_telegram_patient_idx").on(table.organizationId, table.patientId, table.updatedAt),
]);
