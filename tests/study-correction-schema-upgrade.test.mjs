import assert from "node:assert/strict";
import test from "node:test";
import { freshDb } from "./helpers/d1.mjs";

test("0093 expands business document types without losing schema guards or FK integrity",async()=>{
  const {raw,close}=await freshDb();
  try {
    const table=raw.prepare(
      "SELECT sql FROM sqlite_schema WHERE type='table' AND name='business_documents'"
    ).get();
    assert.match(table.sql,/['\"]study_correction['\"]/);
    assert.equal(raw.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name='__new_business_documents'"
    ).get().n,0,"shadow table must not survive the migration");

    assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(),[]);
    assert.equal(raw.prepare("PRAGMA foreign_keys").get().foreign_keys,1);
    assert.equal(raw.prepare("PRAGMA defer_foreign_keys").get().defer_foreign_keys,0);

    const expectedIndexes=[
      "business_documents_basis_idx",
      "business_documents_id_org_idx",
      "business_documents_org_id_idx",
      "business_documents_org_type_number_idx",
      "business_documents_org_type_state_idx",
    ];
    const indexes=new Set(raw.prepare(
      "SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='business_documents' AND sql IS NOT NULL"
    ).all().map((row)=>row.name));
    for (const name of expectedIndexes) assert.ok(indexes.has(name),`missing rebuilt index ${name}`);

    const expectedTriggers=[
      "business_document_basis_integrity_insert",
      "business_documents_identity_immutable",
      "business_documents_immutable_after_draft",
      "business_documents_no_delete_posted",
      "payment_posts_patient_order",
      "result_delivery_document_integrity_insert",
      "service_delivery_reverse_posts_correction",
      "study_performance_integrity_insert",
      "study_performance_operational_post",
      "study_correction_integrity_insert",
    ];
    const triggers=new Set(raw.prepare(
      "SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name='business_documents'"
    ).all().map((row)=>row.name));
    for (const name of expectedTriggers) assert.ok(triggers.has(name),`missing rebuilt trigger ${name}`);

    assert.throws(()=>raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,state,created_by)
       VALUES (1,'forged_type','BAD-1','draft','attacker@example.com')`
    ).run(),/CHECK constraint failed/);

    assert.throws(()=>raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,state,created_by,posted_by,posted_at)
       VALUES (1,'study_correction','КВ-000001','posted','attacker@example.com','attacker@example.com',CURRENT_TIMESTAMP)`
    ).run(),/study_correction_lineage_required/,
    "study_correction must pass the type CHECK and fail closed on its dedicated lineage guard");
  } finally {
    close();
  }
});
