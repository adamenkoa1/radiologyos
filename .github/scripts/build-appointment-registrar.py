from pathlib import Path
import sys

mode = sys.argv[1] if len(sys.argv) > 1 else "pre"

if mode == "pre":
    schema = Path("db/schema.ts")
    text = schema.read_text(encoding="utf-8")
    marker = 'export const counterparties = sqliteTable("counterparties", {'
    assert text.count(marker) == 1
    block = '''export const appointmentDetails = sqliteTable("appointment_details", {
\torganizationId: integer("organization_id").notNull(),
\tdocumentId: integer("document_id").primaryKey().notNull(),
\tbookingId: integer("booking_id").notNull().references(() => bookings.id),
\tappointmentVersion: integer("appointment_version").notNull(),
\tpatientId: text("patient_id").notNull().default(""),
\tserviceCode: text("service_code").notNull(),
\tserviceTitle: text("service_title").notNull(),
\tequipmentId: text("equipment_id").notNull(),
\tdurationMinutes: integer("duration_minutes").notNull(),
\tscheduledDate: text("scheduled_date").notNull(),
\tscheduledTime: text("scheduled_time").notNull(),
\tcreatedAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
\tuniqueIndex("appointment_booking_version_unique").on(table.organizationId, table.bookingId, table.appointmentVersion),
\tindex("appointment_booking_history_idx").on(table.organizationId, table.bookingId, table.appointmentVersion, table.documentId),
\tforeignKey(() => ({
\t\t\tcolumns: [table.documentId, table.organizationId],
\t\t\tforeignColumns: [businessDocuments.id, businessDocuments.organizationId],
\t\t\tname: "appointment_details_document_id_organization_id_business_documents_id_organization_id_fk"
\t\t})),
\tcheck("appointment_details_check_1", sql.raw("`appointment_version` > 0")),
\tcheck("appointment_details_check_2", sql.raw("`duration_minutes` > 0")),
\tcheck("appointment_details_check_3", sql.raw("length(trim(`scheduled_date`)) > 0")),
\tcheck("appointment_details_check_4", sql.raw("length(trim(`scheduled_time`)) > 0")),
]);

'''
    text = text.replace(marker, block + marker, 1)
    schema.write_text(text, encoding="utf-8")

    journal = Path("lib/business-document-journal.ts")
    text = journal.read_text(encoding="utf-8")
    replacements = [
      ("COALESCE(o.booking_id,s.booking_id,sp.booking_id,sc.booking_id,rd.booking_id,rad.booking_id,c.booking_id,f.booking_id) AS bookingId,",
       "COALESCE(o.booking_id,a.booking_id,s.booking_id,sp.booking_id,sc.booking_id,rd.booking_id,rad.booking_id,c.booking_id,f.booking_id) AS bookingId,"),
      ("COALESCE(o.patient_id,s.patient_id,sp.patient_id,sc.patient_id,rd.patient_id,rad.patient_id,c.patient_id,f.patient_id,'') AS patientId,",
       "COALESCE(o.patient_id,a.patient_id,s.patient_id,sp.patient_id,sc.patient_id,rd.patient_id,rad.patient_id,c.patient_id,f.patient_id,'') AS patientId,"),
      ("COALESCE(o.service_title,s.service_title,sp.service_title,sc.service_title,rd.service_title,rad.service_title,c.service_title,b.service,'') AS subject,",
       "COALESCE(o.service_title,a.service_title,s.service_title,sp.service_title,sc.service_title,rd.service_title,rad.service_title,c.service_title,b.service,'') AS subject,"),
      ("b.id=COALESCE(o.booking_id,s.booking_id,sp.booking_id,sc.booking_id,rd.booking_id,rad.booking_id,c.booking_id,f.booking_id)`;",
       "b.id=COALESCE(o.booking_id,a.booking_id,s.booking_id,sp.booking_id,sc.booking_id,rd.booking_id,rad.booking_id,c.booking_id,f.booking_id)`;"),
    ]
    for before, after in replacements:
        assert text.count(before) == 1, before
        text = text.replace(before, after, 1)
    before = """  LEFT JOIN patient_order_details o
    ON o.document_id=d.id AND o.organization_id=d.organization_id
  LEFT JOIN service_delivery_details s"""
    after = """  LEFT JOIN patient_order_details o
    ON o.document_id=d.id AND o.organization_id=d.organization_id
  LEFT JOIN appointment_details a
    ON a.document_id=d.id AND a.organization_id=d.organization_id
  LEFT JOIN service_delivery_details s"""
    assert text.count(before) == 1
    text = text.replace(before, after, 1)
    journal.write_text(text, encoding="utf-8")

elif mode == "post":
    files = sorted(Path("drizzle").glob("0095_*.sql"))
    assert len(files) == 1, files
    generated = files[0]
    generated_stem = generated.stem
    target = Path("drizzle/0095_appointment_registrar.sql")
    if generated != target:
        generated.rename(target)

    journal_path = Path("drizzle/meta/_journal.json")
    journal_text = journal_path.read_text(encoding="utf-8")
    old = f'"tag": "{generated_stem}"'
    assert journal_text.count(old) == 1, generated_stem
    journal_path.write_text(journal_text.replace(old, '"tag": "0095_appointment_registrar"', 1), encoding="utf-8")

    sql = target.read_text(encoding="utf-8").rstrip() + "\n--> statement-breakpoint\n"
    sql += r'''
-- Appointment is an immutable scheduling fact. The mutable booking remains the operational
-- projection; only future bookings receive appointment history. Existing bookings are not backfilled.

CREATE TRIGGER `appointment_document_integrity_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.document_type='appointment'
BEGIN
  SELECT CASE WHEN NEW.state<>'posted'
    THEN RAISE(ABORT,'appointment_must_be_posted') END;
  SELECT CASE WHEN NEW.created_by<>'system:schedule' OR NEW.posted_by<>'system:schedule'
    THEN RAISE(ABORT,'appointment_actor_invalid') END;
  SELECT CASE WHEN NEW.posted_at='' OR NEW.occurred_at='' OR NEW.posted_at<>NEW.occurred_at
    THEN RAISE(ABORT,'appointment_timestamp_invalid') END;
  SELECT CASE WHEN NEW.comment<>'Автоматично з планування заявки'
    THEN RAISE(ABORT,'appointment_comment_invalid') END;
  SELECT CASE WHEN NEW.reversed_document_id IS NOT NULL OR NEW.basis_document_id IS NULL
    THEN RAISE(ABORT,'appointment_basis_invalid') END;

  SELECT CASE WHEN NOT (
    -- First appointment: exact Patient Order root, no earlier appointment history.
    EXISTS (
      SELECT 1
      FROM `patient_order_details` o
      JOIN `business_documents` root
        ON root.id=o.document_id AND root.organization_id=o.organization_id
      JOIN `bookings` b
        ON b.id=o.booking_id AND b.organization_id=o.organization_id
      WHERE o.organization_id=NEW.organization_id
        AND o.document_id=NEW.basis_document_id
        AND root.document_type='patient_order'
        AND b.status<>'cancelled'
        AND NEW.number=printf('АП-%06d-%03d',o.booking_id,1)
        AND NOT EXISTS (
          SELECT 1 FROM `appointment_details` x
          WHERE x.organization_id=o.organization_id AND x.booking_id=o.booking_id
        )
    )
    OR
    -- Reschedule: previous appointment is the exact latest reversed version and no active version remains.
    EXISTS (
      SELECT 1
      FROM `appointment_details` prev
      JOIN `business_documents` pd
        ON pd.id=prev.document_id AND pd.organization_id=prev.organization_id
      JOIN `bookings` b
        ON b.id=prev.booking_id AND b.organization_id=prev.organization_id
      WHERE prev.organization_id=NEW.organization_id
        AND prev.document_id=NEW.basis_document_id
        AND pd.document_type='appointment' AND pd.state='reversed'
        AND b.status<>'cancelled'
        AND prev.appointment_version=(
          SELECT MAX(x.appointment_version) FROM `appointment_details` x
          WHERE x.organization_id=prev.organization_id AND x.booking_id=prev.booking_id
        )
        AND NEW.number=printf('АП-%06d-%03d',prev.booking_id,prev.appointment_version+1)
        AND NOT EXISTS (
          SELECT 1
          FROM `appointment_details` active
          JOIN `business_documents` ad
            ON ad.id=active.document_id AND ad.organization_id=active.organization_id
          WHERE active.organization_id=prev.organization_id AND active.booking_id=prev.booking_id
            AND ad.document_type='appointment' AND ad.state='posted'
        )
    )
  ) THEN RAISE(ABORT,'appointment_basis_or_version_invalid') END;
END;
--> statement-breakpoint

-- Details are generated only from the validated business document and current canonical booking.
CREATE TRIGGER `appointment_details_from_document`
AFTER INSERT ON `business_documents`
WHEN NEW.document_type='appointment'
BEGIN
  INSERT INTO `appointment_details`
    (`organization_id`,`document_id`,`booking_id`,`appointment_version`,`patient_id`,
     `service_code`,`service_title`,`equipment_id`,`duration_minutes`,`scheduled_date`,`scheduled_time`)
  SELECT NEW.organization_id,NEW.id,b.id,
         CASE WHEN root.document_id IS NOT NULL THEN 1 ELSE prev.appointment_version+1 END,
         b.patient_id,b.service_code,b.service,b.equipment_id,b.duration_minutes,b.desired_date,b.desired_time
  FROM `bookings` b
  LEFT JOIN `patient_order_details` root
    ON root.organization_id=NEW.organization_id AND root.booking_id=b.id
   AND root.document_id=NEW.basis_document_id
  LEFT JOIN `appointment_details` prev
    ON prev.organization_id=NEW.organization_id AND prev.booking_id=b.id
   AND prev.document_id=NEW.basis_document_id
  WHERE b.organization_id=NEW.organization_id
    AND (root.document_id IS NOT NULL OR prev.document_id IS NOT NULL)
  LIMIT 1;
END;
--> statement-breakpoint

CREATE TRIGGER `appointment_details_integrity_insert`
BEFORE INSERT ON `appointment_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `bookings` b
      ON b.id=NEW.booking_id AND b.organization_id=NEW.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='appointment' AND d.state='posted'
      AND d.created_by='system:schedule' AND d.posted_by='system:schedule'
      AND d.number=printf('АП-%06d-%03d',NEW.booking_id,NEW.appointment_version)
      AND b.patient_id=NEW.patient_id
      AND b.service_code=NEW.service_code
      AND b.service=NEW.service_title
      AND b.equipment_id=NEW.equipment_id
      AND b.duration_minutes=NEW.duration_minutes
      AND b.desired_date=NEW.scheduled_date
      AND b.desired_time=NEW.scheduled_time
      AND (
        (NEW.appointment_version=1 AND EXISTS (
          SELECT 1 FROM `patient_order_details` o
          WHERE o.organization_id=NEW.organization_id AND o.booking_id=NEW.booking_id
            AND o.document_id=d.basis_document_id
        ))
        OR
        (NEW.appointment_version>1 AND EXISTS (
          SELECT 1
          FROM `appointment_details` prev
          JOIN `business_documents` pd
            ON pd.id=prev.document_id AND pd.organization_id=prev.organization_id
          WHERE prev.organization_id=NEW.organization_id AND prev.booking_id=NEW.booking_id
            AND prev.document_id=d.basis_document_id
            AND prev.appointment_version=NEW.appointment_version-1
            AND pd.document_type='appointment' AND pd.state='reversed'
        ))
      )
  ) THEN RAISE(ABORT,'appointment_snapshot_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `appointment_details_no_update`
BEFORE UPDATE ON `appointment_details`
BEGIN SELECT RAISE(ABORT,'appointment_snapshot_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_details_no_delete`
BEFORE DELETE ON `appointment_details`
BEGIN SELECT RAISE(ABORT,'appointment_snapshot_immutable'); END;
--> statement-breakpoint

-- A posted appointment may be reversed only because the booking was cancelled or its current
-- scheduling snapshot changed. Direct independent reversal while the booking is unchanged is rejected.
CREATE TRIGGER `appointment_reversal_requires_booking_transition`
BEFORE UPDATE OF `state` ON `business_documents`
WHEN OLD.document_type='appointment' AND OLD.state='posted' AND NEW.state='reversed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `appointment_details` a
    JOIN `bookings` b ON b.id=a.booking_id AND b.organization_id=a.organization_id
    WHERE a.document_id=OLD.id AND a.organization_id=OLD.organization_id
      AND (
        b.status='cancelled'
        OR b.patient_id IS NOT a.patient_id
        OR b.service_code IS NOT a.service_code
        OR b.service IS NOT a.service_title
        OR b.equipment_id IS NOT a.equipment_id
        OR b.duration_minutes IS NOT a.duration_minutes
        OR b.desired_date IS NOT a.scheduled_date
        OR b.desired_time IS NOT a.scheduled_time
      )
  ) THEN RAISE(ABORT,'appointment_reversal_requires_booking_transition') END;
END;
--> statement-breakpoint

-- Future booking path: Patient Order creation is the deterministic sequencing hook for Appointment v1.
CREATE TRIGGER `patient_order_appointment_auto_create`
AFTER INSERT ON `patient_order_details`
WHEN EXISTS (
  SELECT 1 FROM `bookings` b
  WHERE b.id=NEW.booking_id AND b.organization_id=NEW.organization_id AND b.status<>'cancelled'
)
AND NOT EXISTS (
  SELECT 1 FROM `appointment_details` a
  WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.booking_id
)
BEGIN
  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,
     `created_by`,`posted_by`,`posted_at`,`basis_document_id`)
  VALUES (
    NEW.organization_id,'appointment',printf('АП-%06d-%03d',NEW.booking_id,1),
    CURRENT_TIMESTAMP,'posted','Автоматично з планування заявки',
    'system:schedule','system:schedule',CURRENT_TIMESTAMP,NEW.document_id
  );
END;
--> statement-breakpoint

-- Only bookings that already have appointment history participate. This is the no-backfill boundary:
-- legacy rows remain on the legacy scheduling path even when they receive unrelated updates.
CREATE TRIGGER `booking_appointment_reschedule`
AFTER UPDATE OF `patient_id`,`service`,`service_code`,`equipment_id`,`duration_minutes`,`desired_date`,`desired_time`
ON `bookings`
WHEN NEW.status<>'cancelled'
  AND (
    NEW.patient_id IS NOT OLD.patient_id
    OR NEW.service IS NOT OLD.service
    OR NEW.service_code IS NOT OLD.service_code
    OR NEW.equipment_id IS NOT OLD.equipment_id
    OR NEW.duration_minutes IS NOT OLD.duration_minutes
    OR NEW.desired_date IS NOT OLD.desired_date
    OR NEW.desired_time IS NOT OLD.desired_time
  )
  AND EXISTS (
    SELECT 1
    FROM `appointment_details` a
    JOIN `business_documents` d ON d.id=a.document_id AND d.organization_id=a.organization_id
    WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.id
      AND d.document_type='appointment' AND d.state='posted'
  )
BEGIN
  UPDATE `business_documents`
  SET state='reversed'
  WHERE organization_id=NEW.organization_id AND document_type='appointment' AND state='posted'
    AND id=(
      SELECT a.document_id
      FROM `appointment_details` a
      JOIN `business_documents` d ON d.id=a.document_id AND d.organization_id=a.organization_id
      WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.id
        AND d.document_type='appointment' AND d.state='posted'
      ORDER BY a.appointment_version DESC LIMIT 1
    );

  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,
     `created_by`,`posted_by`,`posted_at`,`basis_document_id`)
  SELECT NEW.organization_id,'appointment',printf('АП-%06d-%03d',NEW.id,prev.appointment_version+1),
         CURRENT_TIMESTAMP,'posted','Автоматично з планування заявки',
         'system:schedule','system:schedule',CURRENT_TIMESTAMP,prev.document_id
  FROM `appointment_details` prev
  JOIN `business_documents` pd ON pd.id=prev.document_id AND pd.organization_id=prev.organization_id
  WHERE prev.organization_id=NEW.organization_id AND prev.booking_id=NEW.id
    AND pd.document_type='appointment' AND pd.state='reversed'
  ORDER BY prev.appointment_version DESC
  LIMIT 1;
END;
--> statement-breakpoint

CREATE TRIGGER `booking_appointment_cancel`
AFTER UPDATE OF `status` ON `bookings`
WHEN OLD.status<>'cancelled' AND NEW.status='cancelled'
  AND EXISTS (
    SELECT 1
    FROM `appointment_details` a
    JOIN `business_documents` d ON d.id=a.document_id AND d.organization_id=a.organization_id
    WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.id
      AND d.document_type='appointment' AND d.state='posted'
  )
BEGIN
  UPDATE `business_documents`
  SET state='reversed'
  WHERE organization_id=NEW.organization_id AND document_type='appointment' AND state='posted'
    AND id=(
      SELECT a.document_id
      FROM `appointment_details` a
      JOIN `business_documents` d ON d.id=a.document_id AND d.organization_id=a.organization_id
      WHERE a.organization_id=NEW.organization_id AND a.booking_id=NEW.id
        AND d.document_type='appointment' AND d.state='posted'
      ORDER BY a.appointment_version DESC LIMIT 1
    );
END;
--> statement-breakpoint
'''
    target.write_text(sql, encoding="utf-8")

    docs = Path("docs/appointment-registrar.md")
    docs.write_text('''# Appointment registrar\n\n`appointment` is the immutable scheduling-history document for future bookings. The mutable `bookings` row remains the operational projection used by calendar/availability APIs.\n\n## Lifecycle\n\n- A booking created after migration 0095 first receives its Patient Order. Inserting that typed Patient Order detail is the deterministic hook that creates posted Appointment v1.\n- Appointment v1 is based on the exact same-tenant Patient Order.\n- A real change to patient/service/equipment/duration/date/time reverses the current posted appointment and creates the next posted version based on the previous appointment. A no-op update creates nothing.\n- Booking cancellation reverses the current appointment and creates no replacement.\n- Booking completion leaves the last posted appointment unchanged as the fulfilled scheduling fact.\n- Existing bookings are not backfilled and do not enter appointment versioning merely because migration 0095 was installed.\n\nThe document chain is therefore `Patient Order -> Appointment v1 -> Appointment v2 -> ...`. This block intentionally keeps `service_delivery` based directly on Patient Order; changing execution lineage is a separate architecture decision after appointment semantics are proven.\n\n## Snapshot and integrity\n\nEach version stores booking id, patient id, service code/title, equipment, duration, scheduled date/time and a monotonically increasing version. D1 generates the typed snapshot from the canonical booking; API code does not submit appointment facts. Wrong tenant/basis/version/snapshot, duplicate active history, direct independent reversal, and snapshot mutation are rejected. Appointment documents post no finance, inventory, service, equipment-load or staff-output movements.\n''', encoding="utf-8")

    tests = Path("tests/appointment-registrar.behavior.test.mjs")
    tests.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { callWorker,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{organizationId=1,code="RD-APT-001",date="2026-10-01",time="10:00",status="confirmed",service="КТ ОГК",serviceCode="ct-chest",equipmentId="ct",duration=30,patientId="PAT-APT"}={}){
  const result=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (?,?,'Appointment Patient','+380501234500','380501234500',?,'1980-01-02',?,?,?, ?,?,?,'civilian','pending',2500,0,?,1,'apt-doctor@example.com','apt-tech@example.com')`)
    .bind(organizationId,code,patientId,service,serviceCode,equipmentId,duration,date,time,status).run();
  return Number(result.meta.last_row_id);
}

function orderFor(raw,organizationId,bookingId){return raw.prepare(`SELECT d.id,d.state FROM patient_order_details o JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id WHERE o.organization_id=? AND o.booking_id=? LIMIT 1`).get(organizationId,bookingId);}
function appointments(raw,organizationId,bookingId){return raw.prepare(`SELECT d.id,d.number,d.state,d.basis_document_id AS basisDocumentId,
  a.appointment_version AS version,a.patient_id AS patientId,a.service_code AS serviceCode,a.service_title AS serviceTitle,
  a.equipment_id AS equipmentId,a.duration_minutes AS durationMinutes,a.scheduled_date AS scheduledDate,a.scheduled_time AS scheduledTime
  FROM appointment_details a JOIN business_documents d ON d.id=a.document_id AND d.organization_id=a.organization_id
  WHERE a.organization_id=? AND a.booking_id=? ORDER BY a.appointment_version`).all(organizationId,bookingId);}
async function journal(db,cookie,id){return callWorker(new Request(`http://localhost/api/staff/business-documents?id=${id}`,{headers:{cookie}}),db);}
function movementCount(raw,table,documentId){return Number(raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id=?`).get(documentId).n);}

test("future booking creates posted Appointment v1 based on its Patient Order with zero movements",async()=>{
 await withD1(async(db,raw)=>{
  const bookingId=await seedBooking(db);
  const order=orderFor(raw,1,bookingId); assert.ok(order?.id>0);
  const rows=appointments(raw,1,bookingId); assert.equal(rows.length,1); const a=rows[0];
  assert.equal(a.number,`АП-${String(bookingId).padStart(6,"0")}-001`); assert.equal(a.state,"posted"); assert.equal(a.basisDocumentId,order.id); assert.equal(a.version,1);
  assert.equal(a.patientId,"PAT-APT"); assert.equal(a.serviceCode,"ct-chest"); assert.equal(a.serviceTitle,"КТ ОГК"); assert.equal(a.equipmentId,"ct"); assert.equal(a.durationMinutes,30); assert.equal(a.scheduledDate,"2026-10-01"); assert.equal(a.scheduledTime,"10:00");
  for(const table of ["cash_movements","patient_settlement_movements","revenue_movements","services_delivered_movements","service_correction_movements","equipment_load_movements","staff_output_movements","inventory_movements"]) assert.equal(movementCount(raw,table,a.id),0);
  const cookie=await seedStaffSession(db,{email:"apt-journal@example.com",role:"registrar",organizationId:1});
  const detailResponse=await journal(db,cookie,a.id); assert.equal(detailResponse.status,200); const detail=await detailResponse.json();
  assert.equal(detail.document.journalType,"appointment"); assert.equal(detail.document.bookingId,bookingId); assert.equal(detail.document.bookingCode,"RD-APT-001"); assert.equal(detail.document.patientName,"Appointment Patient"); assert.equal(detail.document.patientId,"PAT-APT"); assert.equal(detail.document.subject,"КТ ОГК"); assert.equal(detail.document.amount,0); assert.equal(detail.document.sourceDocumentId,order.id); assert.equal(detail.document.relationType,"based_on");
  assert.ok(detail.relations.parent.some(x=>x.id===order.id&&x.relationType==="based_on"));
 });
});

test("real reschedule reverses current appointment and appends exactly one next version; no-op creates nothing",async()=>{
 await withD1(async(db,raw)=>{
  const bookingId=await seedBooking(db,{code:"RD-APT-RESCHEDULE"});
  const v1=appointments(raw,1,bookingId)[0];
  await db.prepare("UPDATE bookings SET desired_date='2026-10-02',desired_time='11:30' WHERE organization_id=1 AND id=?").bind(bookingId).run();
  let rows=appointments(raw,1,bookingId); assert.equal(rows.length,2);
  assert.equal(rows[0].id,v1.id); assert.equal(rows[0].state,"reversed");
  assert.equal(rows[1].state,"posted"); assert.equal(rows[1].basisDocumentId,v1.id); assert.equal(rows[1].version,2); assert.equal(rows[1].scheduledDate,"2026-10-02"); assert.equal(rows[1].scheduledTime,"11:30");
  await db.prepare("UPDATE bookings SET desired_date=desired_date,desired_time=desired_time WHERE organization_id=1 AND id=?").bind(bookingId).run();
  assert.equal(appointments(raw,1,bookingId).length,2);
  await db.prepare("UPDATE bookings SET equipment_id='ct-2',duration_minutes=45 WHERE organization_id=1 AND id=?").bind(bookingId).run();
  rows=appointments(raw,1,bookingId); assert.equal(rows.length,3); assert.equal(rows[1].state,"reversed"); assert.equal(rows[2].state,"posted"); assert.equal(rows[2].basisDocumentId,rows[1].id); assert.equal(rows[2].version,3); assert.equal(rows[2].equipmentId,"ct-2"); assert.equal(rows[2].durationMinutes,45);
  assert.equal(rows.filter(x=>x.state==="posted").length,1);
 });
});

test("booking cancellation reverses current appointment without replacement; completion keeps it posted",async()=>{
 await withD1(async(db,raw)=>{
  const cancelledId=await seedBooking(db,{code:"RD-APT-CANCEL"});
  await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?").bind(cancelledId).run();
  const cancelled=appointments(raw,1,cancelledId); assert.equal(cancelled.length,1); assert.equal(cancelled[0].state,"reversed");
  assert.equal(orderFor(raw,1,cancelledId).state,"cancelled");

  const completedId=await seedBooking(db,{code:"RD-APT-COMPLETE",time:"12:00"});
  await db.prepare("UPDATE bookings SET performed_at='2026-10-01T12:05:00',status='completed' WHERE organization_id=1 AND id=?").bind(completedId).run();
  const completed=appointments(raw,1,completedId); assert.equal(completed.length,1); assert.equal(completed[0].state,"posted");
  const service=raw.prepare(`SELECT d.basis_document_id AS basisDocumentId FROM service_delivery_details s JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id WHERE s.organization_id=1 AND s.booking_id=? LIMIT 1`).get(completedId);
  assert.equal(service.basisDocumentId,orderFor(raw,1,completedId).id,"0095 must not change service-delivery Patient Order basis");
 });
});

test("D1 rejects independent appointment reversal and snapshot mutation",async()=>{
 await withD1(async(db,raw)=>{
  const bookingId=await seedBooking(db,{code:"RD-APT-GUARD"}); const a=appointments(raw,1,bookingId)[0];
  assert.throws(()=>raw.prepare("UPDATE business_documents SET state='reversed' WHERE id=?").run(a.id),/appointment_reversal_requires_booking_transition/);
  assert.throws(()=>raw.prepare("UPDATE appointment_details SET scheduled_time='23:59' WHERE document_id=?").run(a.id),/appointment_snapshot_immutable/);
  assert.throws(()=>raw.prepare("DELETE FROM appointment_details WHERE document_id=?").run(a.id),/appointment_snapshot_immutable/);
 });
});

test("D1 rejects forged appointment basis, tenant lineage and duplicate active version",async()=>{
 await withD1(async(db,raw)=>{
  raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Appointment Org 2','appointment-org-2',1)");
  const one=await seedBooking(db,{code:"RD-APT-ORG1"});
  const two=await seedBooking(db,{organizationId:2,code:"RD-APT-ORG2",patientId:"PAT-APT-2"});
  const order2=orderFor(raw,2,two); const active=appointments(raw,1,one)[0];
  assert.throws(()=>raw.prepare(`INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id) VALUES (1,'appointment',?,CURRENT_TIMESTAMP,'posted','Автоматично з планування заявки','system:schedule','system:schedule',CURRENT_TIMESTAMP,?)`).run(`АП-${String(one).padStart(6,"0")}-002`,order2.id),/business_document_basis_tenant_mismatch|appointment_basis_or_version_invalid/);
  assert.throws(()=>raw.prepare(`INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id) VALUES (1,'appointment',?,CURRENT_TIMESTAMP,'posted','Автоматично з планування заявки','system:schedule','system:schedule',CURRENT_TIMESTAMP,?)`).run(`АП-${String(one).padStart(6,"0")}-002`,active.id),/appointment_basis_or_version_invalid/);
 });
});

test("migration 0095 does not backfill historical bookings and business core already admits appointment type",async()=>{
 const migration=await readFile(new URL("../drizzle/0095_appointment_registrar.sql",import.meta.url),"utf8");
 const core=await readFile(new URL("../lib/business-core.ts",import.meta.url),"utf8");
 assert.match(core,/"appointment"/);
 assert.match(migration,/AFTER INSERT ON `patient_order_details`/);
 assert.match(migration,/Only bookings that already have appointment history participate/);
 assert.doesNotMatch(migration,/INSERT INTO `business_documents`[\s\S]*SELECT[\s\S]*FROM `bookings`[\s\S]*appointment/iu);
});
''', encoding="utf-8")

else:
    raise SystemExit(f"unknown mode {mode}")
