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
  protocolNumber: text("protocol_number").notNull().default(""),
  protocolStatus: text("protocol_status").notNull().default("not_started"),
  protocolUpdatedAt: text("protocol_updated_at").notNull().default(""),
  paymentStatus: text("payment_status").notNull().default("not_set"),
  paymentAmount: integer("payment_amount").notNull().default(0),
  paymentMethod: text("payment_method").notNull().default(""),
  nszuStatus: text("nszu_status").notNull().default("not_applicable"),
  nszuReference: text("nszu_reference").notNull().default(""),
  assignedRadiologistEmail: text("assigned_radiologist_email").notNull().default(""),
  assignedRadiographerEmail: text("assigned_radiographer_email").notNull().default(""),
  performedAt: text("performed_at").notNull().default(""),
  anatomicalRegionsCount: integer("anatomical_regions_count").notNull().default(1),
  protocolReadyAt: text("protocol_ready_at").notNull().default(""),
  protocolIssuedAt: text("protocol_issued_at").notNull().default(""),
  paidAmount: integer("paid_amount").notNull().default(0),
  externalReference: text("external_reference").notNull().default(""),
  comment: text("comment").notNull().default(""),
  status: text("status").notNull().default("new"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("bookings_equipment_schedule_idx").on(table.equipmentId, table.desiredDate, table.desiredTime),
  index("bookings_report_date_idx").on(table.desiredDate, table.status),
  index("bookings_performed_report_idx").on(table.performedAt, table.equipmentId),
  index("bookings_staff_report_idx").on(table.assignedRadiologistEmail, table.assignedRadiographerEmail),
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

export const protocols = sqliteTable("protocols", {
  bookingId: integer("booking_id").primaryKey(),
  templateKey: text("template_key").notNull().default("generic"),
  method: text("method").notNull().default(""),
  sectionsJson: text("sections_json").notNull().default("{}"),
  findings: text("findings").notNull().default(""),
  conclusion: text("conclusion").notNull().default(""),
  recommendations: text("recommendations").notNull().default(""),
  number: text("number").notNull().default(""),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  authorEmail: text("author_email").notNull().default(""),
  updatedBy: text("updated_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("protocols_status_idx").on(table.status, table.updatedAt)]);

export const reportExports = sqliteTable("report_exports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestedBy: text("requested_by").notNull(),
  reportType: text("report_type").notNull(),
  filtersJson: text("filters_json").notNull().default("{}"),
  columnsJson: text("columns_json").notNull().default("[]"),
  format: text("format").notNull().default("xlsx"),
  rowCount: integer("row_count").notNull().default(0),
  containsPersonalData: integer("contains_personal_data").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("report_exports_created_idx").on(table.createdAt, table.requestedBy)]);
