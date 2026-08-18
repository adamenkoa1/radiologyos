import { sqliteTable, AnySQLiteColumn, index, uniqueIndex, check, integer, text, foreignKey, primaryKey, real } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const bookings = sqliteTable("bookings", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	code: text().notNull(),
	name: text().notNull(),
	phone: text().notNull(),
	service: text().notNull(),
	desiredDate: text("desired_date").notNull(),
	desiredTime: text("desired_time").notNull(),
	referral: text().notNull().default("Уточню у адміністратора"),
	comment: text().notNull().default(""),
	status: text().notNull().default("new"),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	serviceCode: text("service_code").notNull().default("legacy"),
	equipmentId: text("equipment_id").notNull().default("ct"),
	durationMinutes: integer("duration_minutes").notNull().default(30),
	phoneNormalized: text("phone_normalized").notNull().default(""),
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
	patientEmail: text("patient_email").notNull().default(""),
	organizationId: integer("organization_id").notNull().default(1),
	consentAt: text("consent_at").notNull().default(""),
	consentVersion: text("consent_version").notNull().default(""),
	consentSource: text("consent_source").notNull().default(""),
	militaryVerifiedAt: text("military_verified_at").notNull().default(""),
	militaryVerifiedBy: text("military_verified_by").notNull().default(""),
	dateOfBirth: text("date_of_birth").notNull().default(""),
	patientId: text("patient_id").notNull().default(""),
},
table => [
	index("bookings_org_patient_idx").on(table.organizationId, table.patientId, table.desiredDate),
	index("bookings_org_schedule_idx").on(table.organizationId, table.desiredDate, table.desiredTime),
	index("bookings_patient_idx").on(table.phoneNormalized, table.desiredDate),
	index("bookings_staff_report_idx").on(table.assignedRadiologistEmail, table.assignedRadiographerEmail),
	index("bookings_performed_report_idx").on(table.performedAt, table.equipmentId),
	index("bookings_report_date_idx").on(table.desiredDate, table.status),
	index("bookings_equipment_schedule_idx").on(table.equipmentId, table.desiredDate, table.desiredTime),
	uniqueIndex("bookings_code_unique").on(table.code),
]);

export const bookingEvents = sqliteTable("booking_events", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	bookingId: integer("booking_id").notNull(),
	action: text().notNull(),
	details: text().notNull().default(""),
	actor: text().notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	organizationId: integer("organization_id").notNull().default(1),
},
table => [
	index("booking_events_booking_idx").on(table.bookingId, table.createdAt),
]);

export const bookingStaffNotes = sqliteTable("booking_staff_notes", {
	bookingId: integer("booking_id").primaryKey().notNull(),
	note: text().notNull().default(""),
	updatedBy: text("updated_by").notNull(),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	organizationId: integer("organization_id").notNull().default(1),
},
table => [
]);

export const requestLimits = sqliteTable("request_limits", {
	key: text().primaryKey().notNull(),
	attempts: integer().notNull().default(0),
	windowStartedAt: integer("window_started_at").notNull(),
},
table => [
]);

export const staffMembers = sqliteTable("staff_members", {
	email: text().primaryKey().notNull(),
	displayName: text("display_name").notNull().default(""),
	role: text().notNull(),
	active: integer().notNull().default(1),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	passwordHash: text("password_hash").notNull().default(""),
	phone: text().notNull().default(""),
	lastName: text("last_name").notNull().default(""),
	firstName: text("first_name").notNull().default(""),
	patronymic: text().notNull().default(""),
	contactEmail: text("contact_email").notNull().default(""),
	militaryRank: text("military_rank").notNull().default(""),
	positionTitle: text("position_title").notNull().default(""),
},
table => [
	uniqueIndex("staff_members_phone_idx").on(table.phone).where(sql.raw("`phone` != ''")),
]);

export const equipmentBlocks = sqliteTable("equipment_blocks", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	equipmentId: text("equipment_id").notNull(),
	blockedDate: text("blocked_date").notNull(),
	startTime: text("start_time").notNull(),
	endTime: text("end_time").notNull(),
	reason: text().notNull().default(""),
	organizationId: integer("organization_id").notNull().default(1),
},
table => [
	index("equipment_blocks_schedule_idx").on(table.equipmentId, table.blockedDate, table.startTime),
]);

export const reportExports = sqliteTable("report_exports", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	requestedBy: text("requested_by").notNull(),
	reportType: text("report_type").notNull(),
	filtersJson: text("filters_json").notNull().default("{}"),
	columnsJson: text("columns_json").notNull().default("[]"),
	format: text().notNull().default("xlsx"),
	rowCount: integer("row_count").notNull().default(0),
	containsPersonalData: integer("contains_personal_data").notNull().default(0),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	organizationId: integer("organization_id").notNull().default(1),
},
table => [
	index("report_exports_created_idx").on(table.createdAt, table.requestedBy),
]);

export const protocols = sqliteTable("protocols", {
	bookingId: integer("booking_id").primaryKey().notNull(),
	templateKey: text("template_key").notNull().default("generic"),
	method: text().notNull().default(""),
	sectionsJson: text("sections_json").notNull().default("{}"),
	findings: text().notNull().default(""),
	conclusion: text().notNull().default(""),
	recommendations: text().notNull().default(""),
	number: text().notNull().default(""),
	status: text().notNull().default("draft"),
	version: integer().notNull().default(1),
	authorEmail: text("author_email").notNull().default(""),
	updatedBy: text("updated_by").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	organizationId: integer("organization_id").notNull().default(1),
	signedBy: text("signed_by").notNull().default(""),
	signedAt: text("signed_at").notNull().default(""),
	signedVersion: integer("signed_version").notNull().default(0),
},
table => [
	index("protocols_org_number_idx").on(table.organizationId, table.number),
	index("protocols_org_idx").on(table.organizationId, table.status),
	index("protocols_status_idx").on(table.status, table.updatedAt),
]);

export const patientCommunications = sqliteTable("patient_communications", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	phoneNormalized: text("phone_normalized").notNull(),
	channel: text().notNull().default("call"),
	direction: text().notNull().default("outbound"),
	summary: text().notNull().default(""),
	actor: text().notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	organizationId: integer("organization_id").notNull().default(1),
	externalId: text("external_id").notNull().default(""),
	patientId: text("patient_id").notNull().default(""),
},
table => [
	index("patient_communications_org_patient_idx").on(table.organizationId, table.patientId, table.createdAt),
	uniqueIndex("patient_comm_external_idx").on(table.externalId).where(sql.raw("`external_id` != ''")),
	index("patient_communications_org_idx").on(table.organizationId, table.phoneNormalized),
	index("patient_communications_phone_idx").on(table.phoneNormalized, table.createdAt),
]);

export const imagingStudies = sqliteTable("imaging_studies", {
	bookingId: integer("booking_id").primaryKey().notNull(),
	accessionNumber: text("accession_number").notNull().default(""),
	studyInstanceUid: text("study_instance_uid").notNull().default(""),
	modality: text().notNull().default(""),
	seriesCount: integer("series_count").notNull().default(0),
	instancesCount: integer("instances_count").notNull().default(0),
	studyStatus: text("study_status").notNull().default("not_linked"),
	studyDatetime: text("study_datetime").notNull().default(""),
	source: text().notNull().default("manual"),
	updatedBy: text("updated_by").notNull(),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	organizationId: integer("organization_id").notNull().default(1),
},
table => [
	uniqueIndex("imaging_studies_org_uid_idx").on(table.organizationId, table.studyInstanceUid).where(sql.raw("study_instance_uid != ''")),
	index("imaging_studies_org_idx").on(table.organizationId, table.studyStatus),
	index("imaging_studies_status_idx").on(table.studyStatus, table.updatedAt),
]);

export const pacsSettings = sqliteTable("pacs_settings", {
	id: integer().primaryKey().notNull(),
	dicomwebBaseUrl: text("dicomweb_base_url").notNull().default(""),
	viewerBaseUrl: text("viewer_base_url").notNull().default(""),
	aeTitle: text("ae_title").notNull().default(""),
	enabled: integer().notNull().default(0),
	notes: text().notNull().default(""),
	updatedBy: text("updated_by").notNull().default(""),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	organizationId: integer("organization_id").notNull().default(1),
},
table => [
	uniqueIndex("pacs_settings_organization_idx").on(table.organizationId),
]);

export const staffSessions = sqliteTable("staff_sessions", {
	tokenHash: text("token_hash").primaryKey().notNull(),
	email: text().notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	expiresAt: text("expires_at").notNull(),
},
table => [
	index("staff_sessions_expiry_idx").on(table.expiresAt),
]);

export const appSettings = sqliteTable("app_settings", {
	key: text().primaryKey().notNull(),
	value: text().notNull().default(""),
},
table => [
]);

export const servicePrices = sqliteTable("service_prices", {
	code: text().primaryKey().notNull(),
	price: integer().notNull(),
	organizationId: integer("organization_id").notNull().default(1),
},
table => [
]);

export const patientNotifications = sqliteTable("patient_notifications", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	bookingId: integer("booking_id").notNull(),
	kind: text().notNull(),
	channel: text().notNull(),
	recipient: text().notNull().default(""),
	body: text().notNull().default(""),
	status: text().notNull().default("queued"),
	error: text().notNull().default(""),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	sentAt: text("sent_at").notNull().default(""),
	organizationId: integer("organization_id").notNull().default(1),
},
table => [
	index("patient_notifications_org_idx").on(table.organizationId, table.bookingId),
	index("patient_notifications_booking_idx").on(table.bookingId, table.createdAt),
]);

export const organizations = sqliteTable("organizations", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	active: integer().notNull().default(1),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	uniqueIndex("organizations_slug_idx").on(table.slug),
]);

export const organizationProfiles = sqliteTable("organization_profiles", {
	organizationId: integer("organization_id").primaryKey().notNull(),
	profileType: text("profile_type").notNull().default("hospital_radiology"),
	settingsJson: text("settings_json").notNull().default("{}"),
	featureFlagsJson: text("feature_flags_json").notNull().default("{}"),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
]);

export const branches = sqliteTable("branches", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	name: text().notNull(),
	active: integer().notNull().default(1),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("branches_org_idx").on(table.organizationId),
]);

export const departments = sqliteTable("departments", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	branchId: integer("branch_id").notNull().default(0),
	name: text().notNull(),
	active: integer().notNull().default(1),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("departments_org_idx").on(table.organizationId, table.branchId),
]);

export const memberships = sqliteTable("memberships", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	memberEmail: text("member_email").notNull(),
	role: text().notNull(),
	active: integer().notNull().default(1),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("memberships_member_idx").on(table.memberEmail),
	uniqueIndex("memberships_org_member_idx").on(table.organizationId, table.memberEmail),
]);

export const patientSessions = sqliteTable("patient_sessions", {
	tokenHash: text("token_hash").primaryKey().notNull(),
	phoneNormalized: text("phone_normalized").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	expiresAt: text("expires_at").notNull(),
	organizationId: integer("organization_id").notNull().default(1),
	identityKind: text("identity_kind").notNull().default(""),
	identityValue: text("identity_value").notNull().default(""),
	patientId: text("patient_id").notNull().default(""),
},
table => [
	index("patient_sessions_patient_idx").on(table.organizationId, table.patientId, table.expiresAt),
	index("patient_sessions_identity_scope_idx").on(table.organizationId, table.phoneNormalized, table.identityKind, table.identityValue, table.expiresAt),
	index("patient_sessions_org_phone_idx").on(table.organizationId, table.phoneNormalized, table.expiresAt),
	index("patient_sessions_expiry_idx").on(table.expiresAt),
]);

export const bookingRequests = sqliteTable("booking_requests", {
	idempotencyKey: text("idempotency_key").primaryKey().notNull(),
	responseJson: text("response_json").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
]);

export const protocolRevisions = sqliteTable("protocol_revisions", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	bookingId: integer("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" } ),
	version: integer().notNull(),
	templateKey: text("template_key").notNull(),
	method: text().notNull().default(""),
	sectionsJson: text("sections_json").notNull().default("{}"),
	findings: text().notNull().default(""),
	conclusion: text().notNull().default(""),
	recommendations: text().notNull().default(""),
	number: text().notNull().default(""),
	status: text().notNull().default("draft"),
	savedBy: text("saved_by").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	organizationId: integer("organization_id").notNull().default(1),
},
table => [
	index("protocol_revisions_org_booking_idx").on(table.organizationId, table.bookingId, table.version),
	index("protocol_revisions_booking_idx").on(table.bookingId, table.version),
]);

export const securityAuditLog = sqliteTable("security_audit_log", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	actorEmail: text("actor_email").notNull(),
	action: text().notNull(),
	resource: text().notNull(),
	targetId: text("target_id").notNull().default(""),
	detailsJson: text("details_json").notNull().default("{}"),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	organizationId: integer("organization_id").notNull().default(1),
},
table => [
	index("security_audit_created_idx").on(table.organizationId, table.createdAt, table.actorEmail),
]);

export const telegramLinkTokens = sqliteTable("telegram_link_tokens", {
	tokenHash: text("token_hash").primaryKey().notNull(),
	phoneNormalized: text("phone_normalized").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	expiresAt: text("expires_at").notNull(),
	organizationId: integer("organization_id").notNull().default(1),
	identityKind: text("identity_kind").notNull().default(""),
	identityValue: text("identity_value").notNull().default(""),
	patientId: text("patient_id").notNull().default(""),
},
table => [
	index("telegram_link_tokens_patient_idx").on(table.organizationId, table.patientId, table.expiresAt),
	index("telegram_link_tokens_identity_scope_idx").on(table.organizationId, table.phoneNormalized, table.identityKind, table.identityValue, table.expiresAt),
	index("telegram_link_tokens_org_phone_idx").on(table.organizationId, table.phoneNormalized),
]);

export const bookingCapacityLocks = sqliteTable("booking_capacity_locks", {
	organizationId: integer("organization_id").notNull().default(1),
	equipmentId: text("equipment_id").notNull(),
	bookingDate: text("booking_date").notNull(),
	minute: text().notNull(),
	bookingCode: text("booking_code").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("booking_capacity_locks_booking_idx").on(table.organizationId, table.bookingCode),
	primaryKey({ columns: [table.organizationId, table.equipmentId, table.bookingDate, table.minute], name: "booking_capacity_locks_organization_id_equipment_id_booking_date_minute_pk"})
]);

export const bookingMinuteOffsets = sqliteTable("booking_minute_offsets", {
	minuteOffset: integer("minute_offset").primaryKey().notNull(),
},
table => [
]);

export const patientOtpChallenges = sqliteTable("patient_otp_challenges", {
	id: text().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull().default(1),
	phoneNormalized: text("phone_normalized").notNull(),
	purpose: text().notNull().default("cabinet_login"),
	codeHash: text("code_hash").notNull(),
	attempts: integer().notNull().default(0),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	expiresAt: text("expires_at").notNull(),
	consumedAt: text("consumed_at").notNull().default(""),
	identityKind: text("identity_kind").notNull().default(""),
	identityValue: text("identity_value").notNull().default(""),
	patientId: text("patient_id").notNull().default(""),
},
table => [
	index("patient_otp_patient_idx").on(table.organizationId, table.patientId, table.createdAt),
	index("patient_otp_identity_scope_idx").on(table.organizationId, table.phoneNormalized, table.identityKind, table.identityValue, table.createdAt),
	index("patient_otp_expiry_idx").on(table.expiresAt, table.consumedAt),
	index("patient_otp_phone_idx").on(table.organizationId, table.phoneNormalized, table.createdAt),
]);

export const paymentTransactions = sqliteTable("payment_transactions", {
	id: integer().primaryKey({ autoIncrement: true }),
	organizationId: integer("organization_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	amount: integer().notNull(),
	currency: text().notNull().default("UAH"),
	provider: text().notNull(),
	providerReference: text("provider_reference").notNull().default(""),
	status: text().notNull().default("pending"),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	paidAt: text("paid_at").notNull().default(""),
	refundedAt: text("refunded_at").notNull().default(""),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	paymentDocumentId: integer("payment_document_id"),
	refundDocumentId: integer("refund_document_id"),
},
table => [
	uniqueIndex("payment_transactions_one_linked_paid_booking_idx").on(table.organizationId, table.bookingId).where(sql.raw("`status`='paid' AND `payment_document_id` IS NOT NULL")),
	uniqueIndex("payment_transactions_refund_document_idx").on(table.organizationId, table.refundDocumentId).where(sql.raw("`refund_document_id` IS NOT NULL")),
	uniqueIndex("payment_transactions_payment_document_idx").on(table.organizationId, table.paymentDocumentId).where(sql.raw("`payment_document_id` IS NOT NULL")),
	uniqueIndex("payment_transactions_provider_ref_idx").on(table.organizationId, table.provider, table.providerReference).where(sql.raw("provider_reference != ''")),
	index("payment_transactions_booking_idx").on(table.organizationId, table.bookingId, table.createdAt),
	check("payment_transactions_check_1", sql.raw("amount >= 0")),
	check("payment_transactions_check_2", sql.raw("status IN ('pending','paid','failed','refunded','cancelled')")),
]);

export const analyticsEvents = sqliteTable("analytics_events", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull().default(1),
	eventName: text("event_name").notNull(),
	journeyId: text("journey_id").notNull().default(""),
	serviceCode: text("service_code").notNull().default(""),
	patientCategory: text("patient_category").notNull().default(""),
	pageKey: text("page_key").notNull().default(""),
	source: text().notNull().default("server"),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("analytics_events_journey_idx").on(table.organizationId, table.journeyId, table.occurredAt),
	index("analytics_events_org_event_time_idx").on(table.organizationId, table.eventName, table.occurredAt),
	index("analytics_events_org_time_idx").on(table.organizationId, table.occurredAt),
	check("analytics_events_check_1", sql.raw("`event_name` IN ('page_view','service_view','booking_started','slot_selected','booking_created','payment_started','payment_completed','patient_arrived','study_completed')")),
	check("analytics_events_check_2", sql.raw("`patient_category` IN ('','civilian','military')")),
	check("analytics_events_check_3", sql.raw("`source` IN ('client','server')")),
	check("analytics_events_check_4", sql.raw("length(`journey_id`) <= 64")),
	check("analytics_events_check_5", sql.raw("length(`service_code`) <= 16")),
	check("analytics_events_check_6", sql.raw("length(`page_key`) <= 64")),
]);

export const mwlBridgeTokens = sqliteTable("mwl_bridge_tokens", {
	organizationId: integer("organization_id").primaryKey().notNull(),
	tokenHash: text("token_hash").notNull(),
	active: integer().notNull().default(1),
	createdBy: text("created_by").notNull().default(""),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	rotatedAt: text("rotated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	lastUsedAt: text("last_used_at").notNull().default(""),
},
table => [
	uniqueIndex("mwl_bridge_tokens_hash_idx").on(table.tokenHash),
]);

export const mwlPatientIds = sqliteTable("mwl_patient_ids", {
	organizationId: integer("organization_id").notNull(),
	identityKey: text("identity_key").notNull(),
	patientId: text("patient_id").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	uniqueIndex("mwl_patient_ids_org_patient_idx").on(table.organizationId, table.patientId),
	primaryKey({ columns: [table.organizationId, table.identityKey], name: "mwl_patient_ids_organization_id_identity_key_pk"})
]);

export const staffTasks = sqliteTable("staff_tasks", {
	id: integer().primaryKey({ autoIncrement: true }),
	organizationId: integer("organization_id").notNull().default(1),
	title: text().notNull(),
	details: text().notNull().default(""),
	status: text().notNull().default("open"),
	priority: text().notNull().default("normal"),
	dueDate: text("due_date").notNull().default(""),
	bookingId: integer("booking_id"),
	assignedEmail: text("assigned_email").notNull().default(""),
	createdBy: text("created_by").notNull(),
	completedBy: text("completed_by").notNull().default(""),
	completedAt: text("completed_at").notNull().default(""),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	source: text().notNull().default("manual"),
	automationKey: text("automation_key").notNull().default(""),
	sourceEntityType: text("source_entity_type").notNull().default(""),
	sourceEntityId: text("source_entity_id").notNull().default(""),
},
table => [
	index("staff_tasks_org_source_idx").on(table.organizationId, table.source, table.sourceEntityType, table.sourceEntityId),
	uniqueIndex("staff_tasks_org_open_automation_idx").on(table.organizationId, table.automationKey).where(sql.raw("`status` = 'open' AND `automation_key` <> ''")),
	index("staff_tasks_org_booking_idx").on(table.organizationId, table.bookingId, table.id),
	index("staff_tasks_org_assignee_idx").on(table.organizationId, table.assignedEmail, table.status, table.id),
	index("staff_tasks_org_status_due_idx").on(table.organizationId, table.status, table.dueDate, table.id),
	check("staff_tasks_check_1", sql.raw("status IN ('open','done')")),
	check("staff_tasks_check_2", sql.raw("priority IN ('low','normal','high')")),
]);

export const inventoryItems = sqliteTable("inventory_items", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	sku: text().notNull().default(""),
	name: text().notNull(),
	category: text().notNull().default("other"),
	unit: text().notNull().default("шт"),
	minStock: real("min_stock").notNull().default(0),
	active: integer().notNull().default(1),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("inventory_items_org_active_idx").on(table.organizationId, table.active, table.name),
	uniqueIndex("inventory_items_org_sku_idx").on(table.organizationId, table.sku).where(sql.raw("`sku` <> ''")),
]);

export const inventoryLots = sqliteTable("inventory_lots", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	itemId: integer("item_id").notNull().references(() => inventoryItems.id),
	lotNumber: text("lot_number").notNull().default(""),
	expiresOn: text("expires_on").notNull().default(""),
	supplier: text().notNull().default(""),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	supplierCounterpartyId: integer("supplier_counterparty_id"),
},
table => [
	index("inventory_lots_supplier_idx").on(table.organizationId, table.supplierCounterpartyId, table.id).where(sql.raw("`supplier_counterparty_id` IS NOT NULL")),
	index("inventory_lots_org_item_idx").on(table.organizationId, table.itemId, table.expiresOn),
]);

export const inventoryMovements = sqliteTable("inventory_movements", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	itemId: integer("item_id").notNull().references(() => inventoryItems.id),
	lotId: integer("lot_id").notNull().references(() => inventoryLots.id),
	movementType: text("movement_type").notNull(),
	quantityDelta: real("quantity_delta").notNull(),
	reason: text().notNull().default(""),
	bookingId: integer("booking_id"),
	actorEmail: text("actor_email").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	documentId: integer("document_id"),
	documentLineId: integer("document_line_id"),
	warehouseId: integer("warehouse_id"),
	warehouseCode: text("warehouse_code").notNull().default(""),
	warehouseName: text("warehouse_name").notNull().default(""),
},
table => [
	uniqueIndex("inventory_movements_document_line_type_idx").on(table.organizationId, table.documentLineId, table.movementType).where(sql.raw("`document_line_id` IS NOT NULL")),
	index("inventory_movements_warehouse_lot_idx").on(table.organizationId, table.warehouseId, table.lotId, table.id).where(sql.raw("`warehouse_id` IS NOT NULL")),
	index("inventory_movements_warehouse_item_idx").on(table.organizationId, table.warehouseId, table.itemId, table.id).where(sql.raw("`warehouse_id` IS NOT NULL")),
	index("inventory_movements_document_idx").on(table.organizationId, table.documentId, table.id).where(sql.raw("`document_id` IS NOT NULL")),
	index("inventory_movements_org_lot_idx").on(table.organizationId, table.lotId, table.id),
	index("inventory_movements_org_item_idx").on(table.organizationId, table.itemId, table.id),
]);

export const equipmentMaintenance = sqliteTable("equipment_maintenance", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	equipmentId: text("equipment_id").notNull(),
	eventType: text("event_type").notNull(),
	status: text().notNull().default("open"),
	title: text().notNull(),
	details: text().notNull().default(""),
	vendor: text().notNull().default(""),
	assignedEmail: text("assigned_email").notNull().default(""),
	dueDate: text("due_date").notNull().default(""),
	downtimeStart: text("downtime_start").notNull().default(""),
	downtimeEnd: text("downtime_end").notNull().default(""),
	createdBy: text("created_by").notNull(),
	completedBy: text("completed_by").notNull().default(""),
	completedAt: text("completed_at").notNull().default(""),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("equipment_maintenance_org_status_idx").on(table.organizationId, table.status, table.dueDate, table.id),
	index("equipment_maintenance_org_equipment_idx").on(table.organizationId, table.equipmentId, table.id),
]);

export const staffSavedViews = sqliteTable("staff_saved_views", {
	id: integer().primaryKey({ autoIncrement: true }),
	organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" } ),
	memberEmail: text("member_email").notNull().references(() => staffMembers.email, { onDelete: "cascade" } ),
	surface: text().notNull(),
	name: text().notNull(),
	configJson: text("config_json").notNull().default("{}"),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("staff_saved_views_owner_surface_idx").on(table.organizationId, table.memberEmail, table.surface, table.updatedAt),
]);

export const bookingComments = sqliteTable("booking_comments", {
	id: integer().primaryKey({ autoIncrement: true }),
	organizationId: integer("organization_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	authorEmail: text("author_email").notNull(),
	body: text().notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("booking_comments_org_author_idx").on(table.organizationId, table.authorEmail, table.id),
	index("booking_comments_org_booking_idx").on(table.organizationId, table.bookingId, table.id),
]);

export const customFieldDefinitions = sqliteTable("custom_field_definitions", {
	id: integer().primaryKey({ autoIncrement: true }),
	organizationId: integer("organization_id").notNull().references(() => organizations.id),
	entityType: text("entity_type").notNull().default("booking"),
	label: text().notNull(),
	fieldType: text("field_type").notNull(),
	optionsJson: text("options_json").notNull().default("[]"),
	required: integer().notNull().default(0),
	active: integer().notNull().default(1),
	sortOrder: integer("sort_order").notNull().default(0),
	createdBy: text("created_by").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("idx_custom_field_definitions_org_entity").on(table.organizationId, table.entityType, table.active, table.sortOrder, table.id),
	check("custom_field_definitions_check_1", sql.raw("entity_type IN ('booking')")),
	check("custom_field_definitions_check_2", sql.raw("field_type IN ('text','number','date','boolean','select')")),
	check("custom_field_definitions_check_3", sql.raw("required IN (0,1)")),
	check("custom_field_definitions_check_4", sql.raw("active IN (0,1)")),
]);

export const customFieldValues = sqliteTable("custom_field_values", {
	id: integer().primaryKey({ autoIncrement: true }),
	organizationId: integer("organization_id").notNull().references(() => organizations.id),
	definitionId: integer("definition_id").notNull(),
	entityType: text("entity_type").notNull().default("booking"),
	entityId: integer("entity_id").notNull(),
	valueText: text("value_text").notNull(),
	updatedBy: text("updated_by").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("idx_custom_field_values_org_entity").on(table.organizationId, table.entityType, table.entityId, table.definitionId),
	foreignKey(() => ({
			columns: [table.organizationId, table.definitionId],
			foreignColumns: [customFieldDefinitions.organizationId, customFieldDefinitions.id],
			name: "custom_field_values_organization_id_definition_id_custom_field_definitions_organization_id_id_fk"
		})),
	check("custom_field_values_check_1", sql.raw("entity_type IN ('booking')")),
]);

export const patientTelegramIdentities = sqliteTable("patient_telegram_identities", {
	organizationId: integer("organization_id").notNull(),
	phoneNormalized: text("phone_normalized").notNull(),
	identityKind: text("identity_kind").notNull(),
	identityValue: text("identity_value").notNull(),
	telegramChatId: text("telegram_chat_id").notNull().default(""),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	patientId: text("patient_id").notNull().default(""),
},
table => [
	index("patient_telegram_patient_idx").on(table.organizationId, table.patientId, table.updatedAt),
	index("patient_telegram_chat_idx").on(table.telegramChatId).where(sql.raw("telegram_chat_id != ''")),
	primaryKey({ columns: [table.organizationId, table.phoneNormalized, table.identityKind, table.identityValue], name: "patient_telegram_identities_organization_id_phone_normalized_identity_kind_identity_value_pk"})
]);

export const patientProfiles = sqliteTable("patient_profiles", {
	patientId: text("patient_id").notNull().default(sql`(lower(hex(randomblob(16))))`).primaryKey(),
	organizationId: integer("organization_id").notNull().default(1),
	phoneNormalized: text("phone_normalized").notNull(),
	displayName: text("display_name").notNull().default(""),
	birthYear: integer("birth_year").notNull().default(0),
	birthDate: text("birth_date").notNull().default(""),
	email: text().notNull().default(""),
	address: text().notNull().default(""),
	tags: text().notNull().default(""),
	notes: text().notNull().default(""),
	doNotContact: integer("do_not_contact").notNull().default(0),
	telegramChatId: text("telegram_chat_id").notNull().default(""),
	updatedBy: text("updated_by").notNull(),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("patient_profiles_org_updated_idx").on(table.organizationId, table.updatedAt),
	index("patient_profiles_org_phone_idx").on(table.organizationId, table.phoneNormalized),
	index("patient_profiles_phone_idx").on(table.phoneNormalized),
]);

export const protocolAddenda = sqliteTable("protocol_addenda", {
	id: text().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	baseProtocolVersion: integer("base_protocol_version").notNull(),
	reason: text().notNull().default(""),
	correctionText: text("correction_text").notNull().default(""),
	status: text().notNull().default("draft"),
	version: integer().notNull().default(1),
	authorEmail: text("author_email").notNull(),
	updatedBy: text("updated_by").notNull(),
	signedBy: text("signed_by").notNull().default(""),
	signedAt: text("signed_at").notNull().default(""),
	signedVersion: integer("signed_version").notNull().default(0),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("protocol_addenda_status_idx").on(table.organizationId, table.status, table.updatedAt),
	index("protocol_addenda_org_booking_idx").on(table.organizationId, table.bookingId, table.createdAt),
	check("protocol_addenda_check_1", sql.raw("`length`(`id`) = 32 AND `id` NOT GLOB '*[^0-9a-f]*'")),
	check("protocol_addenda_check_2", sql.raw("`length`(`trim`(`reason`)) BETWEEN 1 AND 500")),
	check("protocol_addenda_check_3", sql.raw("`length`(`trim`(`correction_text`)) BETWEEN 1 AND 12000")),
	check("protocol_addenda_check_4", sql.raw("`length`(`trim`(`author_email`)) > 0")),
	check("protocol_addenda_check_5", sql.raw("`length`(`trim`(`updated_by`)) > 0")),
	check("protocol_addenda_check_6", sql.raw("`status` IN ('draft','ready','signed','issued')")),
	check("protocol_addenda_check_7", sql.raw("`base_protocol_version` > 0")),
	check("protocol_addenda_check_8", sql.raw("`version` > 0")),
]);

export const protocolAddendumRevisions = sqliteTable("protocol_addendum_revisions", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	addendumId: text("addendum_id").notNull(),
	organizationId: integer("organization_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	baseProtocolVersion: integer("base_protocol_version").notNull(),
	version: integer().notNull(),
	reason: text().notNull().default(""),
	correctionText: text("correction_text").notNull().default(""),
	status: text().notNull().default("draft"),
	savedBy: text("saved_by").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("protocol_addendum_revisions_scope_idx").on(table.organizationId, table.bookingId, table.addendumId, table.version),
	check("protocol_addendum_revisions_check_1", sql.raw("`length`(`addendum_id`) = 32 AND `addendum_id` NOT GLOB '*[^0-9a-f]*'")),
	check("protocol_addendum_revisions_check_2", sql.raw("`length`(`trim`(`reason`)) BETWEEN 1 AND 500")),
	check("protocol_addendum_revisions_check_3", sql.raw("`length`(`trim`(`correction_text`)) BETWEEN 1 AND 12000")),
	check("protocol_addendum_revisions_check_4", sql.raw("`length`(`trim`(`saved_by`)) > 0")),
	check("protocol_addendum_revisions_check_5", sql.raw("`status` IN ('draft','ready','signed')")),
	check("protocol_addendum_revisions_check_6", sql.raw("`base_protocol_version` > 0")),
	check("protocol_addendum_revisions_check_7", sql.raw("`version` > 0")),
]);

export const businessDocuments = sqliteTable("business_documents", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull().references(() => organizations.id),
	documentType: text("document_type").notNull(),
	number: text().notNull().default(""),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	state: text().notNull().default("draft"),
	comment: text().notNull().default(""),
	createdBy: text("created_by").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	postedBy: text("posted_by").notNull().default(""),
	postedAt: text("posted_at").notNull().default(""),
	reversedDocumentId: integer("reversed_document_id"),
	basisDocumentId: integer("basis_document_id"),
},
table => [
	index("business_documents_basis_idx").on(table.organizationId, table.basisDocumentId, table.id).where(sql.raw("`basis_document_id` IS NOT NULL")),
	uniqueIndex("business_documents_id_org_idx").on(table.id, table.organizationId),
	index("business_documents_org_type_state_idx").on(table.organizationId, table.documentType, table.state, table.occurredAt, table.id),
	uniqueIndex("business_documents_org_type_number_idx").on(table.organizationId, table.documentType, table.number).where(sql.raw("`number` <> ''")),
	uniqueIndex("business_documents_org_id_idx").on(table.organizationId, table.id),
	foreignKey(() => ({
			columns: [table.reversedDocumentId],
			foreignColumns: [table.id],
			name: "business_documents_reversed_document_id_business_documents_id_fk"
		})),
	check("business_documents_check_1", sql.raw("`document_type` IN (\n    'patient_order','appointment','service_delivery','payment','refund',\n    'inventory_receipt','inventory_writeoff','inventory_transfer','inventory_count',\n    'study_performance','result_delivery','study_correction'\n  )")),
	check("business_documents_check_2", sql.raw("`state` IN ('draft','posted','reversed','cancelled')")),
]);

export const inventoryDocumentLines = sqliteTable("inventory_document_lines", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").notNull(),
	lineNo: integer("line_no").notNull(),
	itemId: integer("item_id").notNull().references(() => inventoryItems.id),
	lotId: integer("lot_id").references(() => inventoryLots.id),
	lotNumber: text("lot_number").notNull().default(""),
	expiresOn: text("expires_on").notNull().default(""),
	supplier: text().notNull().default(""),
	quantity: real().notNull(),
	reason: text().notNull().default(""),
	bookingId: integer("booking_id").references(() => bookings.id),
	supplierCounterpartyId: integer("supplier_counterparty_id"),
	warehouseId: integer("warehouse_id"),
	warehouseCode: text("warehouse_code").notNull().default(""),
	warehouseName: text("warehouse_name").notNull().default(""),
	destinationWarehouseId: integer("destination_warehouse_id"),
	destinationWarehouseCode: text("destination_warehouse_code").notNull().default(""),
	destinationWarehouseName: text("destination_warehouse_name").notNull().default(""),
	unitCost: integer("unit_cost").notNull().default(0),
	lineAmount: integer("line_amount").notNull().default(0),
},
table => [
	index("inventory_lines_destination_warehouse_idx").on(table.organizationId, table.destinationWarehouseId, table.documentId, table.lineNo).where(sql.raw("`destination_warehouse_id` IS NOT NULL")),
	index("inventory_lines_warehouse_idx").on(table.organizationId, table.warehouseId, table.documentId, table.lineNo).where(sql.raw("`warehouse_id` IS NOT NULL")),
	index("inventory_document_lines_supplier_idx").on(table.organizationId, table.supplierCounterpartyId, table.documentId).where(sql.raw("`supplier_counterparty_id` IS NOT NULL")),
	uniqueIndex("inventory_document_lines_org_id_idx").on(table.organizationId, table.id),
	uniqueIndex("inventory_document_lines_doc_line_idx").on(table.organizationId, table.documentId, table.lineNo),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "inventory_document_lines_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("inventory_document_lines_check_1", sql.raw("`quantity` > 0")),
	check("inventory_document_lines_check_2", sql.raw("`unit_cost` >= 0")),
	check("inventory_document_lines_check_3", sql.raw("`line_amount` >= 0")),
]);

export const printedFormSnapshots = sqliteTable("printed_form_snapshots", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").notNull(),
	formType: text("form_type").notNull(),
	templateVersion: integer("template_version").notNull().default(1),
	payloadJson: text("payload_json").notNull(),
	generatedBy: text("generated_by").notNull(),
	generatedAt: text("generated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	storageKey: text("storage_key").notNull().default(""),
	sha256: text().notNull(),
	documentState: text("document_state").notNull().default(""),
},
table => [
	uniqueIndex("printed_service_act_state_unique").on(table.organizationId, table.documentId, table.formType, table.templateVersion, table.documentState).where(sql.raw("`form_type`='service_act' AND `document_state` IN ('posted','reversed')")),
	index("printed_form_snapshots_state_idx").on(table.organizationId, table.documentId, table.formType, table.templateVersion, table.documentState, table.id),
	index("printed_form_snapshots_document_idx").on(table.organizationId, table.documentId, table.id),
	uniqueIndex("printed_form_snapshots_same_render_idx").on(table.organizationId, table.documentId, table.formType, table.templateVersion, table.sha256),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "printed_form_snapshots_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("printed_form_snapshots_check_1", sql.raw("`form_type` IN (\n    'invoice','payment_receipt','service_act','referral','protocol','result',\n    'inventory_receipt','inventory_writeoff','inventory_transfer','inventory_count','service_note'\n  )")),
	check("printed_form_snapshots_check_2", sql.raw("`template_version` > 0")),
]);

export const financeDocumentDetails = sqliteTable("finance_document_details", {
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").primaryKey().notNull(),
	bookingId: integer("booking_id").notNull().references(() => bookings.id),
	patientId: text("patient_id").notNull().default(""),
	amount: integer().notNull(),
	currency: text().notNull().default("UAH"),
	method: text().notNull().default(""),
	provider: text().notNull().default(""),
	providerReference: text("provider_reference").notNull().default(""),
	sourceDocumentId: integer("source_document_id").references(() => businessDocuments.id),
	sourceTransactionId: integer("source_transaction_id").references(() => paymentTransactions.id),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	cashAccountId: integer("cash_account_id"),
	cashAccountName: text("cash_account_name").notNull().default(""),
	cashAccountCode: text("cash_account_code").notNull().default(""),
},
table => [
	index("finance_document_cash_account_idx").on(table.organizationId, table.cashAccountId, table.documentId).where(sql.raw("`cash_account_id` IS NOT NULL")),
	uniqueIndex("finance_document_details_source_transaction_idx").on(table.organizationId, table.sourceTransactionId).where(sql.raw("`source_transaction_id` IS NOT NULL")),
	index("finance_document_details_booking_idx").on(table.organizationId, table.bookingId, table.documentId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "finance_document_details_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("finance_document_details_check_1", sql.raw("`amount` > 0")),
]);

export const cashMovements = sqliteTable("cash_movements", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	movementType: text("movement_type").notNull(),
	amountDelta: integer("amount_delta").notNull(),
	currency: text().notNull().default("UAH"),
	method: text().notNull().default(""),
	provider: text().notNull().default(""),
	providerReference: text("provider_reference").notNull().default(""),
	actorEmail: text("actor_email").notNull(),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	cashAccountId: integer("cash_account_id"),
	cashAccountName: text("cash_account_name").notNull().default(""),
	cashAccountCode: text("cash_account_code").notNull().default(""),
},
table => [
	index("cash_movements_account_time_idx").on(table.organizationId, table.cashAccountId, table.occurredAt, table.id).where(sql.raw("`cash_account_id` IS NOT NULL")),
	index("cash_movements_time_idx").on(table.organizationId, table.occurredAt, table.id),
	uniqueIndex("cash_movements_document_idx").on(table.organizationId, table.documentId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "cash_movements_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("cash_movements_check_1", sql.raw("`movement_type` IN ('payment','refund')")),
	check("cash_movements_check_2", sql.raw("`amount_delta` <> 0")),
]);

export const patientSettlementMovements = sqliteTable("patient_settlement_movements", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	patientId: text("patient_id").notNull().default(""),
	movementType: text("movement_type").notNull(),
	amountDelta: integer("amount_delta").notNull(),
	currency: text().notNull().default("UAH"),
	actorEmail: text("actor_email").notNull(),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("patient_settlement_booking_idx").on(table.organizationId, table.bookingId, table.id),
	index("patient_settlement_patient_idx").on(table.organizationId, table.patientId, table.occurredAt, table.id),
	uniqueIndex("patient_settlement_document_idx").on(table.organizationId, table.documentId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "patient_settlement_movements_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("patient_settlement_movements_check_1", sql.raw("`movement_type` IN ('charge','payment','refund','adjustment')")),
	check("patient_settlement_movements_check_2", sql.raw("`amount_delta` <> 0")),
]);

export const serviceDeliveryDetails = sqliteTable("service_delivery_details", {
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").primaryKey().notNull(),
	bookingId: integer("booking_id").notNull().references(() => bookings.id),
	patientId: text("patient_id").notNull().default(""),
	patientCategory: text("patient_category").notNull().default(""),
	serviceCode: text("service_code").notNull(),
	serviceTitle: text("service_title").notNull(),
	equipmentId: text("equipment_id").notNull(),
	durationMinutes: integer("duration_minutes").notNull(),
	anatomicalRegionsCount: integer("anatomical_regions_count").notNull().default(1),
	performedAt: text("performed_at").notNull(),
	radiologistEmail: text("radiologist_email").notNull().default(""),
	radiographerEmail: text("radiographer_email").notNull().default(""),
	priceAmount: integer("price_amount").notNull().default(0),
	chargeAmount: integer("charge_amount").notNull().default(0),
	currency: text().notNull().default("UAH"),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("service_delivery_booking_idx").on(table.organizationId, table.bookingId, table.documentId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "service_delivery_details_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("service_delivery_details_check_1", sql.raw("`duration_minutes` > 0")),
	check("service_delivery_details_check_2", sql.raw("`anatomical_regions_count` > 0")),
	check("service_delivery_details_check_3", sql.raw("`price_amount` >= 0")),
	check("service_delivery_details_check_4", sql.raw("`charge_amount` >= 0")),
]);

export const resultDeliveryDetails = sqliteTable("result_delivery_details", {
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").primaryKey().notNull(),
	bookingId: integer("booking_id").notNull().references(() => bookings.id),
	patientId: text("patient_id").notNull().default(""),
	serviceTitle: text("service_title").notNull(),
	protocolNumber: text("protocol_number").notNull(),
	protocolVersion: integer("protocol_version").notNull(),
	signedBy: text("signed_by").notNull(),
	signedAt: text("signed_at").notNull(),
	deliveredBy: text("delivered_by").notNull(),
	deliveredAt: text("delivered_at").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	uniqueIndex("result_delivery_booking_unique").on(table.organizationId, table.bookingId),
	index("result_delivery_document_idx").on(table.organizationId, table.documentId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "result_delivery_details_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("result_delivery_details_check_1", sql.raw("`protocol_version` > 0")),
]);

export const resultAddendumDeliveryDetails = sqliteTable("result_addendum_delivery_details", {
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").primaryKey().notNull(),
	addendumId: text("addendum_id").notNull().references(() => protocolAddenda.id),
	bookingId: integer("booking_id").notNull().references(() => bookings.id),
	patientId: text("patient_id").notNull().default(""),
	serviceTitle: text("service_title").notNull(),
	baseProtocolNumber: text("base_protocol_number").notNull(),
	baseProtocolVersion: integer("base_protocol_version").notNull(),
	addendumVersion: integer("addendum_version").notNull(),
	signedBy: text("signed_by").notNull(),
	signedAt: text("signed_at").notNull(),
	deliveredBy: text("delivered_by").notNull(),
	deliveredAt: text("delivered_at").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	uniqueIndex("result_addendum_delivery_addendum_unique").on(table.organizationId, table.addendumId),
	index("result_addendum_delivery_booking_idx").on(table.organizationId, table.bookingId, table.documentId),
	index("result_addendum_delivery_document_idx").on(table.organizationId, table.documentId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "result_addendum_delivery_details_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("result_addendum_delivery_details_check_1", sql.raw("`base_protocol_version` > 0")),
	check("result_addendum_delivery_details_check_2", sql.raw("`addendum_version` > 0")),
]);

export const servicesDeliveredMovements = sqliteTable("services_delivered_movements", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	patientId: text("patient_id").notNull().default(""),
	serviceCode: text("service_code").notNull(),
	equipmentId: text("equipment_id").notNull(),
	quantity: integer().notNull().default(1),
	anatomicalRegionsCount: integer("anatomical_regions_count").notNull().default(1),
	performedAt: text("performed_at").notNull(),
	actorEmail: text("actor_email").notNull(),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("services_delivered_service_idx").on(table.organizationId, table.serviceCode, table.performedAt),
	uniqueIndex("services_delivered_document_idx").on(table.organizationId, table.documentId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "services_delivered_movements_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("services_delivered_movements_check_1", sql.raw("`quantity` > 0")),
	check("services_delivered_movements_check_2", sql.raw("`anatomical_regions_count` > 0")),
]);

export const revenueMovements = sqliteTable("revenue_movements", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	patientId: text("patient_id").notNull().default(""),
	serviceCode: text("service_code").notNull(),
	movementType: text("movement_type").notNull(),
	amountDelta: integer("amount_delta").notNull(),
	currency: text().notNull().default("UAH"),
	actorEmail: text("actor_email").notNull(),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("revenue_time_idx").on(table.organizationId, table.occurredAt, table.id),
	uniqueIndex("revenue_document_idx").on(table.organizationId, table.documentId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "revenue_movements_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("revenue_movements_check_1", sql.raw("`movement_type` IN ('service_delivery','service_correction')")),
	check("revenue_movements_check_2", sql.raw("`amount_delta` <> 0")),
]);

export const equipmentLoadMovements = sqliteTable("equipment_load_movements", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	equipmentId: text("equipment_id").notNull(),
	minutesDelta: integer("minutes_delta").notNull(),
	performedAt: text("performed_at").notNull(),
	actorEmail: text("actor_email").notNull(),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("equipment_load_equipment_idx").on(table.organizationId, table.equipmentId, table.performedAt),
	uniqueIndex("equipment_load_document_idx").on(table.organizationId, table.documentId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "equipment_load_movements_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("equipment_load_movements_check_1", sql.raw("`minutes_delta` <> 0")),
]);

export const staffOutputMovements = sqliteTable("staff_output_movements", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	memberEmail: text("member_email").notNull(),
	staffRole: text("staff_role").notNull(),
	unitsDelta: integer("units_delta").notNull().default(1),
	anatomicalRegionsCount: integer("anatomical_regions_count").notNull().default(1),
	performedAt: text("performed_at").notNull(),
	actorEmail: text("actor_email").notNull(),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("staff_output_member_idx").on(table.organizationId, table.memberEmail, table.performedAt),
	uniqueIndex("staff_output_document_role_idx").on(table.organizationId, table.documentId, table.staffRole),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "staff_output_movements_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("staff_output_movements_check_1", sql.raw("`staff_role` IN ('radiologist','radiographer')")),
	check("staff_output_movements_check_2", sql.raw("`units_delta` <> 0")),
	check("staff_output_movements_check_3", sql.raw("`anatomical_regions_count` > 0")),
]);

export const serviceCorrectionDetails = sqliteTable("service_correction_details", {
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").primaryKey().notNull(),
	sourceDocumentId: integer("source_document_id").notNull(),
	bookingId: integer("booking_id").notNull().references(() => bookings.id),
	correctionKind: text("correction_kind").notNull().default("storno"),
	reason: text().notNull(),
	patientId: text("patient_id").notNull().default(""),
	patientCategory: text("patient_category").notNull().default(""),
	serviceCode: text("service_code").notNull(),
	serviceTitle: text("service_title").notNull(),
	equipmentId: text("equipment_id").notNull(),
	durationMinutes: integer("duration_minutes").notNull(),
	anatomicalRegionsCount: integer("anatomical_regions_count").notNull(),
	performedAt: text("performed_at").notNull(),
	radiologistEmail: text("radiologist_email").notNull().default(""),
	radiographerEmail: text("radiographer_email").notNull().default(""),
	chargeAmount: integer("charge_amount").notNull().default(0),
	currency: text().notNull().default("UAH"),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("service_correction_booking_idx").on(table.organizationId, table.bookingId, table.documentId),
	uniqueIndex("service_correction_source_unique").on(table.organizationId, table.sourceDocumentId),
	foreignKey(() => ({
			columns: [table.sourceDocumentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "service_correction_details_source_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "service_correction_details_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("service_correction_details_check_1", sql.raw("`correction_kind`='storno'")),
	check("service_correction_details_check_2", sql.raw("length(trim(`reason`)) >= 5")),
	check("service_correction_details_check_3", sql.raw("`duration_minutes` > 0")),
	check("service_correction_details_check_4", sql.raw("`anatomical_regions_count` > 0")),
	check("service_correction_details_check_5", sql.raw("`charge_amount` >= 0")),
]);

export const serviceCorrectionMovements = sqliteTable("service_correction_movements", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").notNull(),
	sourceDocumentId: integer("source_document_id").notNull(),
	bookingId: integer("booking_id").notNull(),
	patientId: text("patient_id").notNull().default(""),
	serviceCode: text("service_code").notNull(),
	equipmentId: text("equipment_id").notNull(),
	quantityDelta: integer("quantity_delta").notNull(),
	anatomicalRegionsDelta: integer("anatomical_regions_delta").notNull(),
	reason: text().notNull(),
	actorEmail: text("actor_email").notNull(),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	uniqueIndex("service_correction_movement_source_idx").on(table.organizationId, table.sourceDocumentId),
	uniqueIndex("service_correction_movement_document_idx").on(table.organizationId, table.documentId),
	foreignKey(() => ({
			columns: [table.sourceDocumentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "service_correction_movements_source_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "service_correction_movements_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("service_correction_movements_check_1", sql.raw("`quantity_delta`=-1")),
	check("service_correction_movements_check_2", sql.raw("`anatomical_regions_delta` < 0")),
]);

export const patientOrderDetails = sqliteTable("patient_order_details", {
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").primaryKey().notNull(),
	bookingId: integer("booking_id").notNull().references(() => bookings.id),
	patientId: text("patient_id").notNull().default(""),
	patientCategory: text("patient_category").notNull().default(""),
	serviceCode: text("service_code").notNull(),
	serviceTitle: text("service_title").notNull(),
	equipmentId: text("equipment_id").notNull(),
	durationMinutes: integer("duration_minutes").notNull(),
	priceAmount: integer("price_amount").notNull().default(0),
	chargeAmount: integer("charge_amount").notNull().default(0),
	currency: text().notNull().default("UAH"),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("patient_order_patient_idx").on(table.organizationId, table.patientId, table.documentId),
	uniqueIndex("patient_order_booking_unique").on(table.organizationId, table.bookingId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "patient_order_details_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("patient_order_details_check_1", sql.raw("`duration_minutes` > 0")),
	check("patient_order_details_check_2", sql.raw("`price_amount` >= 0")),
	check("patient_order_details_check_3", sql.raw("`charge_amount` >= 0")),
]);

export const appointmentDetails = sqliteTable("appointment_details", {
	organizationId: integer("organization_id").notNull(),
	documentId: integer("document_id").primaryKey().notNull(),
	bookingId: integer("booking_id").notNull().references(() => bookings.id),
	appointmentVersion: integer("appointment_version").notNull(),
	patientId: text("patient_id").notNull().default(""),
	serviceCode: text("service_code").notNull(),
	serviceTitle: text("service_title").notNull(),
	equipmentId: text("equipment_id").notNull(),
	durationMinutes: integer("duration_minutes").notNull(),
	scheduledDate: text("scheduled_date").notNull(),
	scheduledTime: text("scheduled_time").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	uniqueIndex("appointment_booking_version_unique").on(table.organizationId, table.bookingId, table.appointmentVersion),
	index("appointment_booking_history_idx").on(table.organizationId, table.bookingId, table.appointmentVersion, table.documentId),
	foreignKey(() => ({
			columns: [table.documentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "appointment_details_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("appointment_details_check_1", sql.raw("`appointment_version` > 0")),
	check("appointment_details_check_2", sql.raw("`duration_minutes` > 0")),
	check("appointment_details_check_3", sql.raw("length(trim(`scheduled_date`)) > 0")),
	check("appointment_details_check_4", sql.raw("length(trim(`scheduled_time`)) > 0")),
]);

export const counterparties = sqliteTable("counterparties", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull().references(() => organizations.id),
	code: text().notNull().default(""),
	name: text().notNull(),
	kind: text().notNull().default("supplier"),
	taxId: text("tax_id").notNull().default(""),
	phone: text().notNull().default(""),
	email: text().notNull().default(""),
	address: text().notNull().default(""),
	active: integer().notNull().default(1),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("counterparties_org_kind_active_idx").on(table.organizationId, table.kind, table.active, table.name),
	uniqueIndex("counterparties_org_code_idx").on(table.organizationId, table.code).where(sql.raw("`code` <> ''")),
	uniqueIndex("counterparties_org_id_idx").on(table.organizationId, table.id),
	check("counterparties_check_1", sql.raw("`kind` IN ('supplier','payer','both','other')")),
	check("counterparties_check_2", sql.raw("`active` IN (0,1)")),
]);

export const cashAccounts = sqliteTable("cash_accounts", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull().references(() => organizations.id),
	code: text().notNull().default(""),
	name: text().notNull(),
	accountType: text("account_type").notNull().default("cash"),
	currency: text().notNull().default("UAH"),
	active: integer().notNull().default(1),
	isDefault: integer("is_default").notNull().default(0),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("cash_accounts_org_type_active_idx").on(table.organizationId, table.accountType, table.currency, table.active, table.name),
	uniqueIndex("cash_accounts_one_default_idx").on(table.organizationId, table.accountType, table.currency).where(sql.raw("`is_default`=1")),
	uniqueIndex("cash_accounts_org_code_idx").on(table.organizationId, table.code).where(sql.raw("`code` <> ''")),
	uniqueIndex("cash_accounts_org_id_idx").on(table.organizationId, table.id),
	check("cash_accounts_check_1", sql.raw("`account_type` IN ('cash','bank','provider','other')")),
	check("cash_accounts_check_2", sql.raw("`active` IN (0,1)")),
	check("cash_accounts_check_3", sql.raw("`is_default` IN (0,1)")),
]);

export const warehouses = sqliteTable("warehouses", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull().references(() => organizations.id),
	code: text().notNull().default(""),
	name: text().notNull(),
	active: integer().notNull().default(1),
	isDefault: integer("is_default").notNull().default(0),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("warehouses_org_active_name_idx").on(table.organizationId, table.active, table.name, table.id),
	uniqueIndex("warehouses_one_default_idx").on(table.organizationId).where(sql.raw("`is_default`=1")),
	uniqueIndex("warehouses_org_code_idx").on(table.organizationId, table.code).where(sql.raw("`code` <> ''")),
	uniqueIndex("warehouses_org_id_idx").on(table.organizationId, table.id),
	check("warehouses_check_1", sql.raw("`active` IN (0,1)")),
	check("warehouses_check_2", sql.raw("`is_default` IN (0,1)")),
]);

export const supplierPaymentDocuments = sqliteTable("supplier_payment_documents", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull().references(() => organizations.id),
	number: text().notNull().default(""),
	supplierCounterpartyId: integer("supplier_counterparty_id").notNull().references(() => counterparties.id),
	supplierCode: text("supplier_code").notNull().default(""),
	supplierName: text("supplier_name").notNull(),
	cashAccountId: integer("cash_account_id").notNull().references(() => cashAccounts.id),
	cashAccountCode: text("cash_account_code").notNull().default(""),
	cashAccountName: text("cash_account_name").notNull(),
	currency: text().notNull().default("UAH"),
	amount: integer().notNull(),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	state: text().notNull().default("draft"),
	comment: text().notNull().default(""),
	createdBy: text("created_by").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	postedBy: text("posted_by").notNull().default(""),
	postedAt: text("posted_at").notNull().default(""),
},
table => [
	index("supplier_payment_supplier_state_idx").on(table.organizationId, table.supplierCounterpartyId, table.state, table.occurredAt, table.id),
	uniqueIndex("supplier_payment_org_number_idx").on(table.organizationId, table.number).where(sql.raw("`number` <> ''")),
	uniqueIndex("supplier_payment_org_id_idx").on(table.organizationId, table.id),
	check("supplier_payment_documents_check_1", sql.raw("`amount` > 0")),
	check("supplier_payment_documents_check_2", sql.raw("`state` IN ('draft','posted','cancelled')")),
]);

export const supplierPaymentAllocations = sqliteTable("supplier_payment_allocations", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	paymentDocumentId: integer("payment_document_id").notNull(),
	receiptDocumentId: integer("receipt_document_id").notNull(),
	amount: integer().notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("supplier_payment_allocation_receipt_idx").on(table.organizationId, table.receiptDocumentId, table.id),
	uniqueIndex("supplier_payment_allocation_unique").on(table.organizationId, table.paymentDocumentId, table.receiptDocumentId),
	foreignKey(() => ({
			columns: [table.receiptDocumentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "supplier_payment_allocations_receipt_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	foreignKey(() => ({
			columns: [table.paymentDocumentId, table.organizationId],
			foreignColumns: [supplierPaymentDocuments.id, supplierPaymentDocuments.organizationId],
			name: "supplier_payment_allocations_payment_document_id_organization_id_supplier_payment_documents_id_organization_id_fk"
		})),
	check("supplier_payment_allocations_check_1", sql.raw("`amount` > 0")),
]);

export const supplierPayableMovements = sqliteTable("supplier_payable_movements", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	supplierCounterpartyId: integer("supplier_counterparty_id").notNull().references(() => counterparties.id),
	supplierName: text("supplier_name").notNull(),
	receiptDocumentId: integer("receipt_document_id").notNull(),
	paymentDocumentId: integer("payment_document_id"),
	movementType: text("movement_type").notNull(),
	amountDelta: integer("amount_delta").notNull(),
	currency: text().notNull().default("UAH"),
	actorEmail: text("actor_email").notNull(),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("supplier_payable_supplier_time_idx").on(table.organizationId, table.supplierCounterpartyId, table.occurredAt, table.id),
	uniqueIndex("supplier_payable_payment_allocation_unique").on(table.organizationId, table.paymentDocumentId, table.receiptDocumentId).where(sql.raw("`movement_type`='payment_settlement'")),
	uniqueIndex("supplier_payable_receipt_accrual_unique").on(table.organizationId, table.receiptDocumentId, table.supplierCounterpartyId).where(sql.raw("`movement_type`='receipt_accrual'")),
	foreignKey(() => ({
			columns: [table.paymentDocumentId, table.organizationId],
			foreignColumns: [supplierPaymentDocuments.id, supplierPaymentDocuments.organizationId],
			name: "supplier_payable_movements_payment_document_id_organization_id_supplier_payment_documents_id_organization_id_fk"
		})),
	foreignKey(() => ({
			columns: [table.receiptDocumentId, table.organizationId],
			foreignColumns: [businessDocuments.id, businessDocuments.organizationId],
			name: "supplier_payable_movements_receipt_document_id_organization_id_business_documents_id_organization_id_fk"
		})),
	check("supplier_payable_movements_check_1", sql.raw("`movement_type` IN ('receipt_accrual','payment_settlement')")),
	check("supplier_payable_movements_check_2", sql.raw("`amount_delta` <> 0")),
]);

export const supplierCashMovements = sqliteTable("supplier_cash_movements", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	paymentDocumentId: integer("payment_document_id").notNull(),
	supplierCounterpartyId: integer("supplier_counterparty_id").notNull().references(() => counterparties.id),
	supplierName: text("supplier_name").notNull(),
	cashAccountId: integer("cash_account_id").notNull().references(() => cashAccounts.id),
	cashAccountCode: text("cash_account_code").notNull().default(""),
	cashAccountName: text("cash_account_name").notNull(),
	amountDelta: integer("amount_delta").notNull(),
	currency: text().notNull().default("UAH"),
	actorEmail: text("actor_email").notNull(),
	occurredAt: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("supplier_cash_account_time_idx").on(table.organizationId, table.cashAccountId, table.occurredAt, table.id),
	uniqueIndex("supplier_cash_payment_unique").on(table.organizationId, table.paymentDocumentId),
	foreignKey(() => ({
			columns: [table.paymentDocumentId, table.organizationId],
			foreignColumns: [supplierPaymentDocuments.id, supplierPaymentDocuments.organizationId],
			name: "supplier_cash_movements_payment_document_id_organization_id_supplier_payment_documents_id_organization_id_fk"
		})),
	check("supplier_cash_movements_check_1", sql.raw("`amount_delta` < 0")),
]);

export const staffShiftAssignments = sqliteTable("staff_shift_assignments", {
	organizationId: integer("organization_id").notNull(),
	staffEmail: text("staff_email").notNull(),
	presetCode: text("preset_code").notNull(),
	teamIndex: integer("team_index").notNull(),
	anchorDate: text("anchor_date").notNull(),
	createdBy: text("created_by").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedBy: text("updated_by").notNull(),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("staff_shift_assignments_org_idx").on(table.organizationId, table.presetCode),
	foreignKey(() => ({
			columns: [table.organizationId, table.staffEmail],
			foreignColumns: [memberships.organizationId, memberships.memberEmail],
			name: "staff_shift_assignments_organization_id_staff_email_memberships_organization_id_member_email_fk"
		})).onDelete("cascade"),
	primaryKey({ columns: [table.organizationId, table.staffEmail], name: "staff_shift_assignments_organization_id_staff_email_pk"}),
	check("staff_shift_assignments_check_1", sql.raw("`team_index` >= 1")),
	check("staff_shift_assignments_check_2", sql.raw("length(`anchor_date`) = 10")),
]);

export const staffShiftOverrides = sqliteTable("staff_shift_overrides", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	organizationId: integer("organization_id").notNull(),
	staffEmail: text("staff_email").notNull(),
	shiftDate: text("shift_date").notNull(),
	kind: text().notNull(),
	label: text().notNull().default(""),
	startTime: text("start_time").notNull().default(""),
	endTime: text("end_time").notNull().default(""),
	note: text().notNull().default(""),
	createdBy: text("created_by").notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedBy: text("updated_by").notNull(),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
	index("staff_shift_overrides_org_date_idx").on(table.organizationId, table.shiftDate, table.staffEmail),
	foreignKey(() => ({
			columns: [table.organizationId, table.staffEmail],
			foreignColumns: [staffShiftAssignments.organizationId, staffShiftAssignments.staffEmail],
			name: "staff_shift_overrides_organization_id_staff_email_staff_shift_assignments_organization_id_staff_email_fk"
		})).onDelete("cascade"),
	check("staff_shift_overrides_check_1", sql.raw("`kind` IN ('day','evening','night','duty','work','off','recovery','leave','sick','custom')")),
	check("staff_shift_overrides_check_2", sql.raw("length(`shift_date`) = 10")),
]);

export const organizationIntegrationSettings = sqliteTable("organization_integration_settings", {
	organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" } ),
	key: text().notNull(),
	value: text().notNull().default(""),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedBy: text("updated_by"),
},
table => [
	index("organization_integration_settings_org_idx").on(table.organizationId, table.key),
	primaryKey({ columns: [table.organizationId, table.key], name: "organization_integration_settings_organization_id_key_pk"})
]);

