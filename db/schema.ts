import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const bookings = sqliteTable("bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  phoneNormalized: text("phone_normalized").notNull().default(""),
  service: text("service").notNull(),
  serviceCode: text("service_code").notNull().default("legacy"),
  equipmentId: text("equipment_id").notNull().default("ct"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  desiredDate: text("desired_date").notNull(),
  desiredTime: text("desired_time").notNull(),
  referral: text("referral").notNull().default("Уточню у адміністратора"),
  patientCategory: text("patient_category").notNull().default("civilian"),
  referralType: text("referral_type").notNull().default("other"),
  referralNumber: text("referral_number").notNull().default(""),
  marketingSource: text("marketing_source").notNull().default(""),
  comment: text("comment").notNull().default(""),
  status: text("status").notNull().default("new"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("bookings_equipment_schedule_idx").on(table.equipmentId, table.desiredDate, table.desiredTime),
]);

export const bookingEvents = sqliteTable("booking_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("booking_events_booking_idx").on(table.bookingId, table.createdAt)]);

export const bookingStaffNotes = sqliteTable("booking_staff_notes", {
  bookingId: integer("booking_id").primaryKey(),
  note: text("note").notNull().default(""),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const requestLimits = sqliteTable("request_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartedAt: integer("window_started_at").notNull(),
});

export const staffMembers = sqliteTable("staff_members", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  role: text("role").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const equipment = sqliteTable("equipment", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slotMinutes: integer("slot_minutes").notNull(),
  workStart: text("work_start").notNull().default("08:00"),
  workEnd: text("work_end").notNull().default("17:00"),
  active: integer("active").notNull().default(1),
});

export const equipmentBlocks = sqliteTable("equipment_blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: text("equipment_id").notNull(),
  blockedDate: text("blocked_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  reason: text("reason").notNull().default(""),
}, table => [index("equipment_blocks_schedule_idx").on(table.equipmentId, table.blockedDate, table.startTime)]);
