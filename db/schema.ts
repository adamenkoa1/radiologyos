import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const initialOrganizationId = "chernihiv-military-hospital-radiology";
const initialDepartmentId = "chernihiv-military-hospital-radiology-department";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  profile: text("profile").notNull().default("hospital_radiology"),
  locale: text("locale").notNull().default("uk-UA"),
  timezone: text("timezone").notNull().default("Europe/Kyiv"),
  currency: text("currency").notNull().default("UAH"),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const organizationBranches = sqliteTable("organization_branches", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("organization_branches_org_idx").on(table.organizationId, table.active)]);

export const organizationDepartments = sqliteTable("organization_departments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  branchId: text("branch_id").notNull(),
  name: text("name").notNull(),
  profile: text("profile").notNull().default("hospital_radiology"),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("organization_departments_org_idx").on(table.organizationId, table.branchId, table.active),
]);

export const organizationMemberships = sqliteTable("organization_memberships", {
  organizationId: text("organization_id").notNull(),
  staffEmail: text("staff_email").notNull(),
  departmentId: text("department_id").notNull().default(""),
  role: text("role").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  primaryKey({ columns: [table.organizationId, table.staffEmail] }),
  index("organization_memberships_staff_idx").on(table.staffEmail, table.active),
]);

export const organizationSettings = sqliteTable("organization_settings", {
  organizationId: text("organization_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull().default(""),
}, table => [primaryKey({ columns: [table.organizationId, table.key] })]);

export const organizationServicePrices = sqliteTable("organization_service_prices", {
  organizationId: text("organization_id").notNull(),
  code: text("code").notNull(),
  price: integer("price").notNull(),
}, table => [primaryKey({ columns: [table.organizationId, table.code] })]);

export const organizationPatientProfiles = sqliteTable("organization_patient_profiles", {
  organizationId: text("organization_id").notNull(),
  phoneNormalized: text("phone_normalized").notNull(),
  displayName: text("display_name").notNull().default(""),
  birthYear: integer("birth_year").notNull().default(0),
  tags: text("tags").notNull().default(""),
  notes: text("notes").notNull().default(""),
  doNotContact: integer("do_not_contact").notNull().default(0),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [primaryKey({ columns: [table.organizationId, table.phoneNormalized] })]);

export const organizationPacsSettings = sqliteTable("organization_pacs_settings", {
  organizationId: text("organization_id").primaryKey(),
  dicomwebBaseUrl: text("dicomweb_base_url").notNull().default(""),
  viewerBaseUrl: text("viewer_base_url").notNull().default(""),
  aeTitle: text("ae_title").notNull().default(""),
  enabled: integer("enabled").notNull().default(0),
  notes: text("notes").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const bookings = sqliteTable("bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  phoneNormalized: text("phone_normalized").notNull().default(""),
  patientEmail: text("patient_email").notNull().default(""),
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
  index("bookings_org_schedule_idx").on(table.organizationId, table.equipmentId, table.desiredDate, table.desiredTime),
  index("bookings_org_patient_idx").on(table.organizationId, table.phoneNormalized, table.desiredDate),
  index("bookings_equipment_schedule_idx").on(table.equipmentId, table.desiredDate, table.desiredTime),
  index("bookings_report_date_idx").on(table.desiredDate, table.status),
  index("bookings_performed_report_idx").on(table.performedAt, table.equipmentId),
  index("bookings_staff_report_idx").on(table.assignedRadiologistEmail, table.assignedRadiographerEmail),
  index("bookings_patient_idx").on(table.phoneNormalized, table.desiredDate),
]);

export const bookingEvents = sqliteTable("booking_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  bookingId: integer("booking_id").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("booking_events_org_booking_idx").on(table.organizationId, table.bookingId, table.createdAt),
  index("booking_events_booking_idx").on(table.bookingId, table.createdAt),
]);

export const bookingStaffNotes = sqliteTable("booking_staff_notes", {
  bookingId: integer("booking_id").primaryKey(),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
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
  passwordHash: text("password_hash").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const staffSessions = sqliteTable("staff_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  departmentId: text("department_id").notNull().default(initialDepartmentId),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, table => [index("staff_sessions_expiry_idx").on(table.expiresAt)]);

export const patientSessions = sqliteTable("patient_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  phoneNormalized: text("phone_normalized").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, table => [index("patient_sessions_expiry_idx").on(table.expiresAt)]);

export const bookingRequests = sqliteTable("booking_requests", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  responseJson: text("response_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});

export const servicePrices = sqliteTable("service_prices", {
  code: text("code").primaryKey(),
  price: integer("price").notNull(),
});

export const equipment = sqliteTable("equipment", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  name: text("name").notNull(),
  slotMinutes: integer("slot_minutes").notNull(),
  workStart: text("work_start").notNull().default("08:00"),
  workEnd: text("work_end").notNull().default("17:00"),
  active: integer("active").notNull().default(1),
});

export const equipmentBlocks = sqliteTable("equipment_blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  equipmentId: text("equipment_id").notNull(),
  blockedDate: text("blocked_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  reason: text("reason").notNull().default(""),
}, table => [
  index("equipment_blocks_org_schedule_idx").on(
    table.organizationId,
    table.equipmentId,
    table.blockedDate,
    table.startTime,
  ),
  index("equipment_blocks_schedule_idx").on(table.equipmentId, table.blockedDate, table.startTime),
]);

export const protocols = sqliteTable("protocols", {
  bookingId: integer("booking_id").primaryKey(),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
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
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
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
}, table => [
  index("protocol_revisions_org_booking_idx").on(table.organizationId, table.bookingId, table.version),
  index("protocol_revisions_booking_idx").on(table.bookingId, table.version),
]);

export const patientProfiles = sqliteTable("patient_profiles", {
  phoneNormalized: text("phone_normalized").primaryKey(),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  displayName: text("display_name").notNull().default(""),
  birthYear: integer("birth_year").notNull().default(0),
  tags: text("tags").notNull().default(""),
  notes: text("notes").notNull().default(""),
  doNotContact: integer("do_not_contact").notNull().default(0),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("patient_profiles_org_phone_idx").on(table.organizationId, table.phoneNormalized),
]);

export const patientCommunications = sqliteTable("patient_communications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  phoneNormalized: text("phone_normalized").notNull(),
  channel: text("channel").notNull().default("call"),
  direction: text("direction").notNull().default("outbound"),
  summary: text("summary").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("patient_communications_org_phone_idx").on(
    table.organizationId,
    table.phoneNormalized,
    table.createdAt,
  ),
  index("patient_communications_phone_idx").on(table.phoneNormalized, table.createdAt),
]);

export const patientNotifications = sqliteTable("patient_notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
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
  bookingId: integer("booking_id").primaryKey(),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
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
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  dicomwebBaseUrl: text("dicomweb_base_url").notNull().default(""),
  viewerBaseUrl: text("viewer_base_url").notNull().default(""),
  aeTitle: text("ae_title").notNull().default(""),
  enabled: integer("enabled").notNull().default(0),
  notes: text("notes").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reportExports = sqliteTable("report_exports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  requestedBy: text("requested_by").notNull(),
  reportType: text("report_type").notNull(),
  filtersJson: text("filters_json").notNull().default("{}"),
  columnsJson: text("columns_json").notNull().default("[]"),
  format: text("format").notNull().default("xlsx"),
  rowCount: integer("row_count").notNull().default(0),
  containsPersonalData: integer("contains_personal_data").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("report_exports_org_created_idx").on(
    table.organizationId,
    table.createdAt,
    table.requestedBy,
  ),
  index("report_exports_created_idx").on(table.createdAt, table.requestedBy),
]);

export const securityAuditLog = sqliteTable("security_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: text("organization_id").notNull().default(initialOrganizationId),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  targetId: text("target_id").notNull().default(""),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("security_audit_org_created_idx").on(
    table.organizationId,
    table.createdAt,
    table.actorEmail,
  ),
  index("security_audit_created_idx").on(table.createdAt, table.actorEmail),
]);
