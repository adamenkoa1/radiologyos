import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status
     ) VALUES (1,'RD-FIN-STATUS','Status Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-20','14:00','civilian','pending',2200,0,'confirmed')`
  ).run();
  return Number(result.meta.last_row_id);
}

test("linked paid transaction cannot change status to evade full-payment uniqueness",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    const cookie=await seedStaffSession(db,{email:"status-guard@example.com",role:"registrar",organizationId:1});
    const paid=await callWorker(jsonRequest("/api/staff/payments",{
      bookingId,method:"bank_transfer",providerReference:"STATUS-GUARD-PAY",
    },{headers:{cookie}}),db);
    assert.equal(paid.status,200);

    const transaction=raw.prepare(
      `SELECT id,status,payment_document_id AS paymentDocumentId,refund_document_id AS refundDocumentId
       FROM payment_transactions WHERE organization_id=1 AND booking_id=?`
    ).get(bookingId);
    assert.equal(transaction.status,"paid");
    assert.ok(transaction.paymentDocumentId>0);
    assert.equal(transaction.refundDocumentId,null);

    assert.throws(
      ()=>raw.prepare("UPDATE payment_transactions SET status='failed' WHERE id=?").run(transaction.id),
      /payment_transaction_status_mismatch/,
    );
    assert.throws(
      ()=>raw.prepare("UPDATE payment_transactions SET status='cancelled' WHERE id=?").run(transaction.id),
      /payment_transaction_status_mismatch/,
    );
    assert.equal(raw.prepare("SELECT status FROM payment_transactions WHERE id=?").get(transaction.id).status,"paid");
  });
});

test("refund transition is allowed only when refund document link is set in the same state change",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    const cookie=await seedStaffSession(db,{email:"status-refund@example.com",role:"registrar",organizationId:1});
    const paid=await callWorker(jsonRequest("/api/staff/payments",{
      bookingId,method:"cash",providerReference:"STATUS-REFUND-PAY",
    },{headers:{cookie}}),db);
    assert.equal(paid.status,200);

    const transaction=raw.prepare("SELECT id FROM payment_transactions WHERE organization_id=1 AND booking_id=?").get(bookingId);
    assert.throws(
      ()=>raw.prepare("UPDATE payment_transactions SET status='refunded' WHERE id=?").run(transaction.id),
      /payment_transaction_status_mismatch/,
    );

    const returned=await callWorker(new Request("http://localhost/api/staff/payments",{
      method:"DELETE",headers:{"content-type":"application/json",cookie},body:JSON.stringify({bookingId}),
    }),db);
    assert.equal(returned.status,200);
    const after=raw.prepare(
      "SELECT status,refund_document_id AS refundDocumentId FROM payment_transactions WHERE id=?"
    ).get(transaction.id);
    assert.equal(after.status,"refunded");
    assert.ok(after.refundDocumentId>0);

    assert.throws(
      ()=>raw.prepare("UPDATE payment_transactions SET status='paid' WHERE id=?").run(transaction.id),
      /refund_transaction_status_mismatch/,
    );
  });
});
