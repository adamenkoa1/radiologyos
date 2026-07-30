import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// ── Tenant foundation ────────────────────────────────────────────────────────
// Мультитенантність вводиться еволюційно: усі бізнес-сутності належать
// організації (`organizationId`), який завжди береться з перевіреної серверної
// сесії, а не з тіла запиту. Початковий tenant — Чернігівський військовий
// госпіталь (див. drizzle/0015_tenant_foundation.sql).

export const organizations = sqliteTable("organizations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("organizations_slug_idx").on(table.slug)]);

export const organizationProfiles = sqliteTable("organization_profiles", {
  organizationId: integer("organization_id").primaryKey(),
  profileType: text("profile_type").notNull().default("hospital_radiology"),
  settingsJson: text("settings_json").notNull().default("{}"),
  featureFlagsJson: text("feature_flags_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const branches = sqliteTable("branches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("branches_org_idx").on(table.organizationId)]);

export const departments = sqliteTable("departments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").notNull(),
  branchId: integer("branch_id").notNull().default(0),
  name: text("name").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("departments_org_idx").on(table.organizationId, table.branchId)]);

export const memberships = sqliteTable("memberships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").notNull(),
  memberEmail: text("member_email").notNull(),
  role: text("role").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("memberships_org_member_idx").on(table.organizationId, table.memberEmail),
  index("memberships_member_idx").on(table.memberEmail),
]);

export const bookings = sqliteTable("bookings", {
  organizationId: integer("organization_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  phoneNormalized: text("phone_normalized").notNull().default(""),
  patientEmail: text("patient_email").notNull().default(""),
  dateOfBirth: text("date_of_birth").notNull().default(""),
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
  consentAt: text("consent_at").notNull().default(""),
  consentVersion: text("consent_version").notNull().default(""),
  consentSource: text("consent_source").notNull().default(""),
  militaryVerifiedAt: text("military_verified_at").notNull().default(""),
  militaryVerifiedBy: text("military_verified_by").notNull().default(""),
  comment: text("comment").notNull().default(""),
  status: text("status").notNull().default("new"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("bookings_equipment_schedule_idx").on(table.equipmentId, table.desiredDate, table.desiredTime),
  index("bookings_report_date_idx").on(table.desiredDate, table.status),
  index("bookings_performed_report_idx").on(table.performedAt, table.equipmentId),
  index("bookings_staff_report_idx").on(table.assignedRadiologistEmail, table.assignedRadiographerEmail),
  index("bookings_patient_idx").on(table.phoneNormalized, table.desiredDate),
]);

export const bookingEvents = sqliteTable("booking_events", {
  organizationId: integer("organization_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("booking_events_booking_idx").on(table.bookingId, table.createdAt)]);

export const bookingStaffNotes = sqliteTable("booking_staff_notes", {
  organizationId: integer("organization_id").notNull().default(1),
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
  phone: text("phone").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  role: text("role").notNull(),
  active: integer("active").notNull().default(1),
  passwordHash: text("password_hash").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("staff_members_phone_idx").on(table.phone)]);

export const staffSessions = sqliteTable("staff_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, table => [index("staff_sessions_expiry_idx").on(table.expiresAt)]);

export const patientSessions = sqliteTable("patient_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  phoneNormalized: text("phone_normalized").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, table => [index("patient_sessions_expiry_idx").on(table.expiresAt)]);

export const bookingRequests = sqliteTable("booking_requests", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  responseJson: text("response_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});

export const servicePrices = sqliteTable("service_prices", {
  organizationId: integer("organization_id").notNull().default(1),
  code: text("code").primaryKey(),
  price: integer("price").notNull(),
});

export const equipment = sqliteTable("equipment", {
  organizationId: integer("organization_id").notNull().default(1),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slotMinutes: integer("slot_minutes").notNull(),
  workStart: text("work_start").notNull().default("08:00"),
  workEnd: text("work_end").notNull().default("17:00"),
  active: integer("active").notNull().default(1),
});

export const equipmentBlocks = sqliteTable("equipment_blocks", {
  organizationId: integer("organization_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: text("equipment_id").notNull(),
  blockedDate: text("blocked_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  reason: text("reason").notNull().default(""),
}, table => [index("equipment_blocks_schedule_idx").on(table.equipmentId, table.blockedDate, table.startTime)]);

export const protocols = sqliteTable("protocols", {
  organizationId: integer("organization_id").notNull().default(1),
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

export const protocolRevisions = sqliteTable("protocol_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull(),
  version: integer("version").notNull(),
  templateKey: text("template_key").notNull(),
  method: text("method").notNull().default(""),
  sectionsJson: text("sections_json").notNull().default("{}"),
  findings: text("findings").notNull().default(""),
  conclusion: text("conclusion").notNull().default(""),
  recommendations: text("recommendations").notNull().default(""),
  number: text("number").notNull().default(""),
  status: text("status").notNull().default("draft"),
  savedBy: text("saved_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("protocol_revisions_booking_idx").on(table.bookingId, table.version)]);

export const patientProfiles = sqliteTable("patient_profiles", {
  organizationId: integer("organization_id").notNull().default(1),
  phoneNormalized: text("phone_normalized").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  birthYear: integer("birth_year").notNull().default(0),
  birthDate: text("birth_date").notNull().default(""),
  email: text("email").notNull().default(""),
  address: text("address").notNull().default(""),
  tags: text("tags").notNull().default(""),
  notes: text("notes").notNull().default(""),
  doNotContact: integer("do_not_contact").notNull().default(0),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const patientCommunications = sqliteTable("patient_communications", {
  organizationId: integer("organization_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  phoneNormalized: text("phone_normalized").notNull(),
  channel: text("channel").notNull().default("call"),
  direction: text("direction").notNull().default("outbound"),
  summary: text("summary").notNull().default(""),
  actor: text("actor").notNull(),
  externalId: text("external_id").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("patient_communications_phone_idx").on(table.phoneNormalized, table.createdAt)]);

export const patientNotifications = sqliteTable("patient_notifications", {
  organizationId: integer("organization_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull(),
  kind: text("kind").notNull(),
  channel: text("channel").notNull(),
  recipient: text("recipient").notNull().default(""),
  body: text("body").notNull().default(""),
  status: text("status").notNull().default("queued"),
  error: text("error").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  sentAt: text("sent_at").notNull().default(""),
}, table => [index("patient_notifications_booking_idx").on(table.bookingId, table.createdAt)]);

export const imagingStudies = sqliteTable("imaging_studies", {
  organizationId: integer("organization_id").notNull().default(1),
  bookingId: integer("booking_id").primaryKey(),
  accessionNumber: text("accession_number").notNull().default(""),
  studyInstanceUid: text("study_instance_uid").notNull().default(""),
  modality: text("modality").notNull().default(""),
  seriesCount: integer("series_count").notNull().default(0),
  instancesCount: integer("instances_count").notNull().default(0),
  studyStatus: text("study_status").notNull().default("not_linked"),
  studyDatetime: text("study_datetime").notNull().default(""),
  source: text("source").notNull().default("manual"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("imaging_studies_status_idx").on(table.studyStatus, table.updatedAt)]);

export const pacsSettings = sqliteTable("pacs_settings", {
  id: integer("id").primaryKey(),
  dicomwebBaseUrl: text("dicomweb_base_url").notNull().default(""),
  viewerBaseUrl: text("viewer_base_url").notNull().default(""),
  aeTitle: text("ae_title").notNull().default(""),
  enabled: integer("enabled").notNull().default(0),
  notes: text("notes").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reportExports = sqliteTable("report_exports", {
  organizationId: integer("organization_id").notNull().default(1),
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

export const securityAuditLog = sqliteTable("security_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  targetId: text("target_id").notNull().default(""),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("security_audit_created_idx").on(table.createdAt, table.actorEmail)]);
