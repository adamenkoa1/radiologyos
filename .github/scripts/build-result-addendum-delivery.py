from pathlib import Path
import json, sys

mode = sys.argv[1] if len(sys.argv) > 1 else "pre"

if mode == "pre":
    schema = Path("db/schema.ts")
    text = schema.read_text(encoding="utf-8")
    marker = 'export const servicesDeliveredMovements = sqliteTable("services_delivered_movements", {'
    assert text.count(marker) == 1
    block = '''export const resultAddendumDeliveryDetails = sqliteTable("result_addendum_delivery_details", {
\torganizationId: integer("organization_id").notNull(),
\tdocumentId: integer("document_id").primaryKey().notNull(),
\taddendumId: text("addendum_id").notNull().references(() => protocolAddenda.id),
\tbookingId: integer("booking_id").notNull().references(() => bookings.id),
\tpatientId: text("patient_id").notNull().default(""),
\tserviceTitle: text("service_title").notNull(),
\tbaseProtocolNumber: text("base_protocol_number").notNull(),
\tbaseProtocolVersion: integer("base_protocol_version").notNull(),
\taddendumVersion: integer("addendum_version").notNull(),
\tsignedBy: text("signed_by").notNull(),
\tsignedAt: text("signed_at").notNull(),
\tdeliveredBy: text("delivered_by").notNull(),
\tdeliveredAt: text("delivered_at").notNull(),
\tcreatedAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
table => [
\tuniqueIndex("result_addendum_delivery_addendum_unique").on(table.organizationId, table.addendumId),
\tindex("result_addendum_delivery_booking_idx").on(table.organizationId, table.bookingId, table.documentId),
\tindex("result_addendum_delivery_document_idx").on(table.organizationId, table.documentId),
\tforeignKey(() => ({
\t\t\tcolumns: [table.documentId, table.organizationId],
\t\t\tforeignColumns: [businessDocuments.id, businessDocuments.organizationId],
\t\t\tname: "result_addendum_delivery_details_document_id_organization_id_business_documents_id_organization_id_fk"
\t\t})),
\tcheck("result_addendum_delivery_details_check_1", sql.raw("`base_protocol_version` > 0")),
\tcheck("result_addendum_delivery_details_check_2", sql.raw("`addendum_version` > 0")),
]);

'''
    text = text.replace(marker, block + marker, 1)
    schema.write_text(text, encoding="utf-8")

    journal = Path("lib/business-document-journal.ts")
    text = journal.read_text(encoding="utf-8")
    text = text.replace(
        "CASE WHEN c.document_id IS NOT NULL THEN 'service_correction' ELSE d.document_type END AS journalType,",
        "CASE WHEN rad.document_id IS NOT NULL THEN 'result_addendum_delivery' WHEN c.document_id IS NOT NULL THEN 'service_correction' ELSE d.document_type END AS journalType,",
        1,
    )
    for before, after in [
        ("COALESCE(o.booking_id,s.booking_id,sp.booking_id,sc.booking_id,rd.booking_id,c.booking_id,f.booking_id) AS bookingId,",
         "COALESCE(o.booking_id,s.booking_id,sp.booking_id,sc.booking_id,rd.booking_id,rad.booking_id,c.booking_id,f.booking_id) AS bookingId,"),
        ("COALESCE(o.patient_id,s.patient_id,sp.patient_id,sc.patient_id,rd.patient_id,c.patient_id,f.patient_id,'') AS patientId,",
         "COALESCE(o.patient_id,s.patient_id,sp.patient_id,sc.patient_id,rd.patient_id,rad.patient_id,c.patient_id,f.patient_id,'') AS patientId,"),
        ("COALESCE(o.service_title,s.service_title,sp.service_title,sc.service_title,rd.service_title,c.service_title,b.service,'') AS subject,",
         "COALESCE(o.service_title,s.service_title,sp.service_title,sc.service_title,rd.service_title,rad.service_title,c.service_title,b.service,'') AS subject,"),
        ("b.id=COALESCE(o.booking_id,s.booking_id,sp.booking_id,sc.booking_id,rd.booking_id,c.booking_id,f.booking_id)`;",
         "b.id=COALESCE(o.booking_id,s.booking_id,sp.booking_id,sc.booking_id,rd.booking_id,rad.booking_id,c.booking_id,f.booking_id)`;"),
    ]:
        assert text.count(before) == 1, before
        text = text.replace(before, after, 1)
    before = """  LEFT JOIN result_delivery_details rd
    ON rd.document_id=d.id AND rd.organization_id=d.organization_id
  LEFT JOIN service_correction_details c"""
    after = """  LEFT JOIN result_delivery_details rd
    ON rd.document_id=d.id AND rd.organization_id=d.organization_id
  LEFT JOIN result_addendum_delivery_details rad
    ON rad.document_id=d.id AND rad.organization_id=d.organization_id
  LEFT JOIN service_correction_details c"""
    assert text.count(before) == 1
    text = text.replace(before, after, 1)
    old = "CASE WHEN c.document_id IS NOT NULL THEN 'service_correction' ELSE d.document_type END AS journalType,"
    new = "CASE WHEN rad.document_id IS NOT NULL THEN 'result_addendum_delivery' WHEN c.document_id IS NOT NULL THEN 'service_correction' ELSE d.document_type END AS journalType,"
    assert text.count(old) == 2
    text = text.replace(old, new)
    old = """       LEFT JOIN service_correction_details c
         ON c.document_id=d.id AND c.organization_id=d.organization_id
       WHERE d.organization_id=? AND d.id=? LIMIT 1`"""
    new = """       LEFT JOIN service_correction_details c
         ON c.document_id=d.id AND c.organization_id=d.organization_id
       LEFT JOIN result_addendum_delivery_details rad
         ON rad.document_id=d.id AND rad.organization_id=d.organization_id
       WHERE d.organization_id=? AND d.id=? LIMIT 1`"""
    assert text.count(old) == 1
    text = text.replace(old, new, 1)
    old = """     LEFT JOIN service_correction_details c
       ON c.document_id=d.id AND c.organization_id=d.organization_id
     LEFT JOIN finance_document_details f"""
    new = """     LEFT JOIN service_correction_details c
       ON c.document_id=d.id AND c.organization_id=d.organization_id
     LEFT JOIN result_addendum_delivery_details rad
       ON rad.document_id=d.id AND rad.organization_id=d.organization_id
     LEFT JOIN finance_document_details f"""
    assert text.count(old) == 1
    text = text.replace(old, new, 1)
    journal.write_text(text, encoding="utf-8")

    page = Path("app/staff/documents/page.tsx")
    text = page.read_text(encoding="utf-8")
    before = '  study_performance:"Виконання дослідження",study_correction:"Сторно дослідження",result_delivery:"Видача результату",'
    after = '  study_performance:"Виконання дослідження",study_correction:"Сторно дослідження",result_delivery:"Видача результату",result_addendum_delivery:"Видача виправлення",'
    assert text.count(before) == 1
    page.write_text(text.replace(before, after, 1), encoding="utf-8")

elif mode == "post":
    files = sorted(Path("drizzle").glob("0094_*.sql"))
    assert len(files) == 1, files
    generated = files[0]
    target = Path("drizzle/0094_result_addendum_delivery.sql")
    if generated != target:
        generated.rename(target)

    journal_path = Path("drizzle/meta/_journal.json")
    journal = json.loads(journal_path.read_text(encoding="utf-8"))
    assert journal["entries"][-1]["idx"] == 94
    journal["entries"][-1]["tag"] = "0094_result_addendum_delivery"
    journal_path.write_text(json.dumps(journal, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    sql = target.read_text(encoding="utf-8").rstrip() + "\n--> statement-breakpoint\n"
    sql += r'''
-- Extend result_delivery integrity to support the addendum-delivery subtype while preserving
-- the existing base-protocol delivery contract.
DROP TRIGGER IF EXISTS `result_delivery_document_integrity_insert`;
--> statement-breakpoint
CREATE TRIGGER `result_delivery_document_integrity_insert`
BEFORE INSERT ON `business_documents`
WHEN NEW.document_type='result_delivery'
BEGIN
  SELECT CASE WHEN NEW.state<>'posted'
    THEN RAISE(ABORT,'result_delivery_must_be_posted') END;
  SELECT CASE WHEN NEW.created_by='' OR NEW.posted_by='' OR NEW.created_by<>NEW.posted_by
    THEN RAISE(ABORT,'result_delivery_actor_invalid') END;
  SELECT CASE WHEN NEW.occurred_at='' OR NEW.posted_at='' OR NEW.occurred_at<>NEW.posted_at
    THEN RAISE(ABORT,'result_delivery_timestamp_invalid') END;
  SELECT CASE WHEN NEW.reversed_document_id IS NOT NULL
    THEN RAISE(ABORT,'result_delivery_reversal_invalid') END;
  SELECT CASE WHEN NEW.comment NOT IN ('Видача результату пацієнту','Видача виправлення до протоколу пацієнту')
    THEN RAISE(ABORT,'result_delivery_comment_invalid') END;

  SELECT CASE WHEN NOT (
    (
      NEW.comment='Видача результату пацієнту'
      AND EXISTS (
        SELECT 1
        FROM `protocols` p
        JOIN `bookings` b ON b.id=p.booking_id AND b.organization_id=p.organization_id
        WHERE p.organization_id=NEW.organization_id
          AND p.status='issued'
          AND p.signed_by<>'' AND p.signed_at<>'' AND p.signed_version=p.version
          AND NEW.number=printf('ВР-%06d',p.booking_id)
          AND (
            (NEW.basis_document_id IS NULL AND NOT EXISTS (
              SELECT 1 FROM `business_documents` perf
              JOIN `business_documents` src ON src.id=perf.basis_document_id AND src.organization_id=perf.organization_id
              JOIN `service_delivery_details` s ON s.document_id=src.id AND s.organization_id=src.organization_id
              WHERE perf.organization_id=NEW.organization_id
                AND perf.document_type='study_performance' AND perf.state='posted'
                AND src.document_type='service_delivery' AND s.booking_id=p.booking_id
            ))
            OR NEW.basis_document_id=(
              SELECT perf.id FROM `business_documents` perf
              JOIN `business_documents` src ON src.id=perf.basis_document_id AND src.organization_id=perf.organization_id
              JOIN `service_delivery_details` s ON s.document_id=src.id AND s.organization_id=src.organization_id
              WHERE perf.organization_id=NEW.organization_id
                AND perf.document_type='study_performance' AND perf.state='posted'
                AND src.document_type='service_delivery' AND s.booking_id=p.booking_id
              ORDER BY perf.id DESC LIMIT 1
            )
          )
      )
    )
    OR
    (
      NEW.comment='Видача виправлення до протоколу пацієнту'
      AND EXISTS (
        SELECT 1
        FROM `protocol_addenda` a
        JOIN `protocols` p
          ON p.organization_id=a.organization_id AND p.booking_id=a.booking_id
         AND p.version=a.base_protocol_version AND p.status='issued'
        JOIN `bookings` b ON b.id=a.booking_id AND b.organization_id=a.organization_id
        WHERE a.organization_id=NEW.organization_id
          AND a.status='issued'
          AND a.signed_by<>'' AND a.signed_at<>'' AND a.signed_version=a.version
          AND NEW.number='ВК-'||a.id
          AND (
            (NEW.basis_document_id IS NULL AND NOT EXISTS (
              SELECT 1 FROM `result_delivery_details` rd
              WHERE rd.organization_id=a.organization_id AND rd.booking_id=a.booking_id
            ))
            OR NEW.basis_document_id=(
              SELECT rd.document_id FROM `result_delivery_details` rd
              WHERE rd.organization_id=a.organization_id AND rd.booking_id=a.booking_id
              LIMIT 1
            )
          )
      )
    )
  ) THEN RAISE(ABORT,'result_delivery_protocol_or_basis_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `result_addendum_delivery_details_from_document`
AFTER INSERT ON `business_documents`
WHEN NEW.document_type='result_delivery' AND NEW.comment='Видача виправлення до протоколу пацієнту'
BEGIN
  INSERT INTO `result_addendum_delivery_details`
    (`organization_id`,`document_id`,`addendum_id`,`booking_id`,`patient_id`,`service_title`,
     `base_protocol_number`,`base_protocol_version`,`addendum_version`,`signed_by`,`signed_at`,
     `delivered_by`,`delivered_at`)
  SELECT NEW.organization_id,NEW.id,a.id,a.booking_id,b.patient_id,b.service,
         p.number,a.base_protocol_version,a.version,a.signed_by,a.signed_at,
         NEW.posted_by,NEW.posted_at
  FROM `protocol_addenda` a
  JOIN `protocols` p
    ON p.organization_id=a.organization_id AND p.booking_id=a.booking_id
   AND p.version=a.base_protocol_version AND p.status='issued'
  JOIN `bookings` b ON b.id=a.booking_id AND b.organization_id=a.organization_id
  WHERE a.organization_id=NEW.organization_id AND a.status='issued'
    AND NEW.number='ВК-'||a.id;
END;
--> statement-breakpoint

CREATE TRIGGER `result_addendum_delivery_details_integrity_insert`
BEFORE INSERT ON `result_addendum_delivery_details`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `protocol_addenda` a
      ON a.organization_id=d.organization_id AND d.number='ВК-'||a.id
    JOIN `protocols` p
      ON p.organization_id=a.organization_id AND p.booking_id=a.booking_id
     AND p.version=a.base_protocol_version AND p.status='issued'
    JOIN `bookings` b ON b.id=a.booking_id AND b.organization_id=a.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='result_delivery' AND d.state='posted'
      AND d.comment='Видача виправлення до протоколу пацієнту'
      AND d.created_by=NEW.delivered_by AND d.posted_by=NEW.delivered_by
      AND d.occurred_at=NEW.delivered_at AND d.posted_at=NEW.delivered_at
      AND a.id=NEW.addendum_id AND a.booking_id=NEW.booking_id AND a.status='issued'
      AND a.signed_by<>'' AND a.signed_at<>'' AND a.signed_version=a.version
      AND b.patient_id=NEW.patient_id AND b.service=NEW.service_title
      AND p.number=NEW.base_protocol_number
      AND a.base_protocol_version=NEW.base_protocol_version
      AND a.version=NEW.addendum_version
      AND a.signed_by=NEW.signed_by AND a.signed_at=NEW.signed_at
      AND (
        (d.basis_document_id IS NULL AND NOT EXISTS (
          SELECT 1 FROM `result_delivery_details` rd
          WHERE rd.organization_id=a.organization_id AND rd.booking_id=a.booking_id
        ))
        OR d.basis_document_id=(
          SELECT rd.document_id FROM `result_delivery_details` rd
          WHERE rd.organization_id=a.organization_id AND rd.booking_id=a.booking_id
          LIMIT 1
        )
      )
  ) THEN RAISE(ABORT,'result_addendum_delivery_snapshot_mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `result_addendum_delivery_details_no_update`
BEFORE UPDATE ON `result_addendum_delivery_details`
BEGIN SELECT RAISE(ABORT,'result_addendum_delivery_snapshot_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `result_addendum_delivery_details_no_delete`
BEFORE DELETE ON `result_addendum_delivery_details`
BEGIN SELECT RAISE(ABORT,'result_addendum_delivery_snapshot_immutable'); END;
--> statement-breakpoint

-- Atomic bridge: addendum issuance and delivery evidence are one transaction.
CREATE TRIGGER `result_addendum_delivery_from_issue`
AFTER UPDATE OF `status` ON `protocol_addenda`
WHEN OLD.status='signed' AND NEW.status='issued'
BEGIN
  INSERT INTO `business_documents`
    (`organization_id`,`document_type`,`number`,`occurred_at`,`state`,`comment`,
     `created_by`,`posted_by`,`posted_at`,`basis_document_id`)
  VALUES (
    NEW.organization_id,'result_delivery','ВК-'||NEW.id,CURRENT_TIMESTAMP,'posted',
    'Видача виправлення до протоколу пацієнту',NEW.updated_by,NEW.updated_by,CURRENT_TIMESTAMP,
    (SELECT rd.document_id FROM `result_delivery_details` rd
     WHERE rd.organization_id=NEW.organization_id AND rd.booking_id=NEW.booking_id LIMIT 1)
  );
END;
--> statement-breakpoint
'''
    target.write_text(sql, encoding="utf-8")

    test = Path("tests/result-addendum-delivery-registrar.behavior.test.mjs")
    test.write_text(r'''import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedPatientSession,seedStaffSession,withD1 } from "./helpers/d1.mjs";

const PHONE="380501119988";

async function seedBooking(db,{code="RD-ADD-DELIVERY",organizationId=1,patientId="PAT-ADD-DELIVERY",doctor="add-delivery-doctor@example.com"}={}) {
  await db.prepare(`INSERT OR IGNORE INTO patient_profiles
    (patient_id,organization_id,phone_normalized,display_name,updated_by)
    VALUES (?,?,?,'Addendum Delivery Patient','test')`).bind(patientId,organizationId,PHONE).run();
  const r=await db.prepare(`INSERT INTO bookings
    (organization_id,code,name,phone,phone_normalized,patient_id,date_of_birth,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status,
     anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (?,?,'Addendum Delivery Patient',?,? ,?,'1980-01-02','КТ ОГК','ct-chest','ct',30,
      '2026-09-25','10:00','civilian','pending',2500,0,'confirmed',2,?,'add-delivery-tech@example.com')`)
    .bind(organizationId,code,`+${PHONE}`,PHONE,patientId,doctor).run();
  return Number(r.meta.last_row_id);
}

function protocolPayload(bookingId,baseVersion,status) { return {
  bookingId,baseVersion,status,templateKey:"generic",method:"КТ без контрастування",sections:{},
  findings:"Основний опис",conclusion:"Основний висновок",recommendations:"",number:`P-ADD-${bookingId}`,
}; }
async function putProtocol(db,cookie,payload){return callWorker(jsonRequest("/api/staff/protocols",payload,{method:"PUT",headers:{cookie}}),db);}
async function issueBase(db,doctor,bookingId){
  await db.prepare("UPDATE bookings SET performed_at='2026-09-25T10:05:00',status='completed' WHERE organization_id=1 AND id=?").bind(bookingId).run();
  let r=await putProtocol(db,doctor,protocolPayload(bookingId,0,"ready")); assert.equal(r.status,200); let b=await r.json();
  r=await putProtocol(db,doctor,protocolPayload(bookingId,b.version,"signed")); assert.equal(r.status,200); b=await r.json();
  r=await putProtocol(db,doctor,protocolPayload(bookingId,b.version,"issued")); assert.equal(r.status,200);
  return r.json();
}
async function createAndIssueAddendum(db,doctor,registrar,bookingId){
  let r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{bookingId,reason:"Уточнення",correctionText:"У висновку слід читати: без гострих змін."},{method:"POST",headers:{cookie:registrar}}),db);
  assert.equal(r.status,201); let b=await r.json(); const id=b.addendum.id;
  r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{id,baseVersion:1,reason:"Уточнення",correctionText:"У висновку слід читати: без гострих змін.",status:"ready"},{method:"PUT",headers:{cookie:registrar}}),db); assert.equal(r.status,200); b=await r.json();
  r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{id,baseVersion:b.addendum.version,reason:"Уточнення",correctionText:"У висновку слід читати: без гострих змін.",status:"signed"},{method:"PUT",headers:{cookie:doctor}}),db); assert.equal(r.status,200); b=await r.json(); const signed=b.addendum;
  r=await callWorker(jsonRequest("/api/staff/protocols/addenda",{id,baseVersion:signed.version,reason:signed.reason,correctionText:signed.correctionText,status:"issued"},{method:"PUT",headers:{cookie:registrar}}),db); assert.equal(r.status,200);
  return {id,signed,issued:(await r.json()).addendum};
}
function baseDelivery(raw,bookingId){return raw.prepare(`SELECT d.id FROM business_documents d JOIN result_delivery_details r ON r.document_id=d.id AND r.organization_id=d.organization_id WHERE r.organization_id=1 AND r.booking_id=? LIMIT 1`).get(bookingId);}
function addendumDelivery(raw,id,organizationId=1){return raw.prepare(`SELECT d.id,d.number,d.state,d.basis_document_id AS basisDocumentId,d.created_by AS createdBy,d.posted_by AS postedBy,d.posted_at AS postedAt,
  x.addendum_id AS addendumId,x.booking_id AS bookingId,x.patient_id AS patientId,x.service_title AS serviceTitle,x.base_protocol_number AS baseProtocolNumber,
  x.base_protocol_version AS baseProtocolVersion,x.addendum_version AS addendumVersion,x.signed_by AS signedBy,x.signed_at AS signedAt,x.delivered_by AS deliveredBy,x.delivered_at AS deliveredAt
  FROM business_documents d JOIN result_addendum_delivery_details x ON x.document_id=d.id AND x.organization_id=d.organization_id
  WHERE d.organization_id=? AND x.addendum_id=? LIMIT 1`).get(organizationId,id);}
async function journal(db,cookie,id=null){return callWorker(new Request(`http://localhost/api/staff/business-documents${id?`?id=${id}`:""}`,{headers:{cookie}}),db);}
function movementCount(raw,table,documentId){return Number(raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id=?`).get(documentId).n);}

test("issued addendum atomically creates immutable neutral result-delivery subtype based on base delivery",async()=>{
 await withD1(async(db,raw)=>{
  const doctorEmail="add-delivery-doctor@example.com";
  const doctor=await seedStaffSession(db,{email:doctorEmail,role:"radiologist",organizationId:1});
  const registrarEmail="add-delivery-registrar@example.com";
  const registrar=await seedStaffSession(db,{email:registrarEmail,role:"registrar",organizationId:1});
  const bookingId=await seedBooking(db,{doctor:doctorEmail}); await issueBase(db,doctor,bookingId);
  const base=baseDelivery(raw,bookingId); assert.ok(base?.id>0);
  const {id,signed,issued}=await createAndIssueAddendum(db,doctor,registrar,bookingId);
  assert.equal(issued.version,signed.version); const delivery=addendumDelivery(raw,id); assert.ok(delivery?.id>0);
  assert.equal(delivery.number,`ВК-${id}`); assert.equal(delivery.state,"posted"); assert.equal(delivery.basisDocumentId,base.id);
  assert.equal(delivery.bookingId,bookingId); assert.equal(delivery.patientId,"PAT-ADD-DELIVERY"); assert.equal(delivery.serviceTitle,"КТ ОГК");
  assert.equal(delivery.baseProtocolNumber,`P-ADD-${bookingId}`); assert.equal(delivery.baseProtocolVersion,2); assert.equal(delivery.addendumVersion,signed.version);
  assert.equal(delivery.signedBy,doctorEmail); assert.equal(delivery.signedAt,signed.signedAt); assert.equal(delivery.deliveredBy,registrarEmail); assert.equal(delivery.createdBy,registrarEmail); assert.equal(delivery.postedBy,registrarEmail); assert.equal(delivery.deliveredAt,delivery.postedAt);
  for(const table of ["cash_movements","patient_settlement_movements","revenue_movements","services_delivered_movements","service_correction_movements","equipment_load_movements","staff_output_movements","inventory_movements"]) assert.equal(movementCount(raw,table,delivery.id),0);
  const jr=await journal(db,registrar); assert.equal(jr.status,200); const list=await jr.json(); const row=list.documents.find(x=>x.id===delivery.id);
  assert.equal(row.journalType,"result_addendum_delivery"); assert.equal(row.bookingId,bookingId); assert.equal(row.bookingCode,"RD-ADD-DELIVERY"); assert.equal(row.patientName,"Addendum Delivery Patient"); assert.equal(row.patientId,"PAT-ADD-DELIVERY"); assert.equal(row.subject,"КТ ОГК"); assert.equal(row.amount,0); assert.equal(row.sourceDocumentId,base.id); assert.equal(row.relationType,"based_on");
  const detailResponse=await journal(db,registrar,delivery.id); assert.equal(detailResponse.status,200); const detail=await detailResponse.json(); assert.ok(detail.relations.parent.some(x=>x.id===base.id && x.relationType==="based_on"));
  await assert.rejects(db.prepare("UPDATE result_addendum_delivery_details SET service_title='tamper' WHERE document_id=?").bind(delivery.id).run(),/snapshot_immutable/i);
  await assert.rejects(db.prepare("DELETE FROM result_addendum_delivery_details WHERE document_id=?").bind(delivery.id).run(),/snapshot_immutable/i);
  await assert.rejects(db.prepare("UPDATE business_documents SET state='reversed' WHERE id=?").bind(delivery.id).run(),/result_delivery_document_immutable/i);
  await assert.rejects(db.prepare(`INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id) VALUES (1,'result_delivery',?,CURRENT_TIMESTAMP,'posted','Видача виправлення до протоколу пацієнту',?,?,CURRENT_TIMESTAMP,?)`).bind(delivery.number,registrarEmail,registrarEmail,base.id).run(),/UNIQUE constraint failed/i);
  const patient=await seedPatientSession(db,PHONE,1,{kind:"booking",value:"RD-ADD-DELIVERY"},"PAT-ADD-DELIVERY");
  const pr=await callWorker(jsonRequest("/api/my-protocol",{code:"RD-ADD-DELIVERY"},{headers:{cookie:patient}}),db); assert.equal(pr.status,200); const pb=await pr.json(); assert.equal(pb.protocol.addenda.some(a=>a.id===id),true);
 });
});

test("legacy issued protocol without base delivery creates addendum delivery with null basis",async()=>{
 await withD1(async(db,raw)=>{
  const doctorEmail="legacy-add-doctor@example.com"; const doctor=await seedStaffSession(db,{email:doctorEmail,role:"radiologist",organizationId:1}); const registrar=await seedStaffSession(db,{email:"legacy-add-reg@example.com",role:"registrar",organizationId:1});
  const bookingId=await seedBooking(db,{code:"RD-ADD-LEGACY",doctor:doctorEmail});
  raw.prepare("UPDATE bookings SET status='completed',protocol_status='issued',protocol_issued_at=CURRENT_TIMESTAMP WHERE organization_id=1 AND id=?").run(bookingId);
  raw.prepare(`INSERT INTO protocols (organization_id,booking_id,number,status,version,author_email,updated_by,findings,conclusion,signed_by,signed_at,signed_version) VALUES (1,?,'LEGACY-P','issued',1,?,?, 'Опис','Висновок',?,CURRENT_TIMESTAMP,1)`).run(bookingId,doctorEmail,doctorEmail,doctorEmail);
  assert.equal(baseDelivery(raw,bookingId),undefined);
  const {id}=await createAndIssueAddendum(db,doctor,registrar,bookingId); const delivery=addendumDelivery(raw,id); assert.ok(delivery?.id>0); assert.equal(delivery.basisDocumentId,null); assert.equal(delivery.baseProtocolVersion,1);
 });
});

test("addendum delivery fails closed for forged lineage and remains tenant isolated",async()=>{
 await withD1(async(db,raw)=>{
  const doctorEmail="guard-add-doctor@example.com"; const doctor=await seedStaffSession(db,{email:doctorEmail,role:"radiologist",organizationId:1}); const registrar=await seedStaffSession(db,{email:"guard-add-reg@example.com",role:"registrar",organizationId:1});
  const bookingId=await seedBooking(db,{code:"RD-ADD-GUARD",doctor:doctorEmail}); await issueBase(db,doctor,bookingId); const {id}=await createAndIssueAddendum(db,doctor,registrar,bookingId); const delivery=addendumDelivery(raw,id); assert.ok(delivery?.id>0);
  raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Addendum Org 2','addendum-org-2',1)");
  await assert.rejects(db.prepare(`INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by,posted_by,posted_at,basis_document_id) VALUES (2,'result_delivery',?,CURRENT_TIMESTAMP,'posted','Видача виправлення до протоколу пацієнту','x@example.com','x@example.com',CURRENT_TIMESTAMP,?)`).bind(delivery.number,delivery.basisDocumentId).run(),/business_document_basis_tenant_mismatch|result_delivery_protocol_or_basis_mismatch/i);
  const org2=await seedStaffSession(db,{email:"add-org2@example.com",role:"registrar",organizationId:2}); const list=await journal(db,org2); const body=await list.json(); assert.equal(body.documents.some(x=>x.id===delivery.id),false); assert.equal((await journal(db,org2,delivery.id)).status,404);
 });
});

test("0094 contains no historical addendum-delivery backfill",async()=>{
 const {readFile}=await import("node:fs/promises"); const migration=await readFile(new URL("../drizzle/0094_result_addendum_delivery.sql",import.meta.url),"utf8");
 assert.match(migration,/AFTER UPDATE OF `status` ON `protocol_addenda`/); assert.match(migration,/OLD\.status='signed' AND NEW\.status='issued'/); assert.doesNotMatch(migration,/INSERT INTO `business_documents`[\s\S]*SELECT[\s\S]*FROM `protocol_addenda`[\s\S]*status='issued'/i);
});
''', encoding="utf-8")

else:
    raise SystemExit(f"unknown mode {mode}")
