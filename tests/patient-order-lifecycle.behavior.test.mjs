import assert from "node:assert/strict";
import test from "node:test";
import { refundLatestPayment,settleVerifiedProviderPayment } from "../lib/payment-settlement.ts";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{
  organizationId=1,
  code="RD-LIFECYCLE-001",
  amount=2600,
  status="confirmed",
  desiredTime="10:00",
}={}){
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,
      status,anatomical_regions_count,assigned_radiologist_email,assigned_radiographer_email
     ) VALUES (?,?,'Lifecycle Patient','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-25',?,'civilian','pending',?,0,?,2,'lifecycle-doctor@example.com','lifecycle-tech@example.com')`
  ).bind(organizationId,code,desiredTime,amount,status).run();
  return Number(result.meta.last_row_id);
}

function orderFor(raw,organizationId,bookingId){
  return raw.prepare(
    `SELECT d.id,d.state,d.number
     FROM patient_order_details o
     JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
     WHERE o.organization_id=? AND o.booking_id=? AND d.document_type='patient_order'`
  ).get(organizationId,bookingId);
}

function serviceFor(raw,organizationId,bookingId){
  return raw.prepare(
    `SELECT d.id,d.state
     FROM service_delivery_details s
     JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id
     WHERE s.organization_id=? AND s.booking_id=? AND d.document_type='service_delivery'`
  ).get(organizationId,bookingId);
}

async function storno(db,cookie,sourceDocumentId){
  return callWorker(jsonRequest("/api/staff/service-deliveries/corrections",{
    sourceDocumentId,
    reason:"Сторно перед фінальним скасуванням заявки",
  },{headers:{cookie}}),db);
}

test("cancelling a booking closes its still-draft Patient Order",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db);
    const order=orderFor(raw,1,bookingId);
    assert.equal(order.state,"draft");

    await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?")
      .bind(bookingId).run();

    assert.equal(raw.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId).status,"cancelled");
    assert.equal(orderFor(raw,1,bookingId).state,"cancelled");
  });
});

test("a draft Patient Order cannot be cancelled independently from its booking",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-LIFECYCLE-ROOT"});
    const order=orderFor(raw,1,bookingId);

    assert.throws(()=>raw.prepare(
      "UPDATE business_documents SET state='cancelled' WHERE organization_id=1 AND id=?"
    ).run(order.id),/patient_order_cancel_requires_booking_cancelled/);
    assert.equal(orderFor(raw,1,bookingId).state,"draft");
    assert.equal(raw.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId).status,"confirmed");
  });
});

test("a paid fact blocks cancellation until refund; posted Patient Order remains historical",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-LIFECYCLE-PAID",amount:2900});
    await settleVerifiedProviderPayment(db,{
      organizationId:1,
      bookingId,
      provider:"liqpay",
      providerReference:"lifecycle-paid",
      amount:2900,
    });
    const order=orderFor(raw,1,bookingId);
    assert.equal(order.state,"posted");

    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?"
    ).run(bookingId),/booking_cancel_payment_refund_required/);
    assert.equal(raw.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId).status,"confirmed");

    const refunded=await refundLatestPayment(db,{
      organizationId:1,
      bookingId,
      actor:"lifecycle@example.com",
    });
    assert.equal(refunded.changed,true);
    await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?")
      .bind(bookingId).run();

    assert.equal(raw.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId).status,"cancelled");
    assert.equal(orderFor(raw,1,bookingId).state,"posted");
    assert.equal(raw.prepare(
      "SELECT status FROM payment_transactions WHERE organization_id=1 AND booking_id=? ORDER BY id DESC LIMIT 1"
    ).get(bookingId).status,"refunded");
  });
});

test("a posted service blocks cancellation until storno, then completed -> cancelled is allowed",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-LIFECYCLE-SERVICE",amount:3100});
    await db.prepare(
      "UPDATE bookings SET performed_at='2026-08-25T10:05:00',status='completed' WHERE organization_id=1 AND id=?"
    ).bind(bookingId).run();
    const order=orderFor(raw,1,bookingId);
    const service=serviceFor(raw,1,bookingId);
    assert.equal(order.state,"posted");
    assert.equal(service.state,"posted");

    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?"
    ).run(bookingId));
    assert.equal(raw.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId).status,"completed");

    const cookie=await seedStaffSession(db,{email:"lifecycle-storno@example.com",role:"registrar",organizationId:1});
    const response=await storno(db,cookie,service.id);
    assert.equal(response.status,201);
    assert.equal(serviceFor(raw,1,bookingId).state,"reversed");

    await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?")
      .bind(bookingId).run();
    assert.equal(raw.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId).status,"cancelled");
    assert.equal(orderFor(raw,1,bookingId).state,"posted");

    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET payment_amount=1 WHERE organization_id=1 AND id=?"
    ).run(bookingId),/service_delivery_booking_immutable/);
  });
});

test("a draft downstream business document blocks booking cancellation",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-LIFECYCLE-DRAFT"});
    const order=orderFor(raw,1,bookingId);
    raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,occurred_at,state,comment,created_by,basis_document_id)
       VALUES (1,'payment','ОП-DRAFT-CANCEL',CURRENT_TIMESTAMP,'draft','draft child','lifecycle@example.com',?)`
    ).run(order.id);

    assert.throws(()=>raw.prepare(
      "UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?"
    ).run(bookingId),/booking_cancel_downstream_draft_exists/);
    assert.equal(raw.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId).status,"confirmed");
    assert.equal(orderFor(raw,1,bookingId).state,"draft");
  });
});

test("a cancelled Patient Order cannot become the basis of a new economic document",async()=>{
  await withD1(async(db,raw)=>{
    const bookingId=await seedBooking(db,{code:"RD-LIFECYCLE-BASIS"});
    await db.prepare("UPDATE bookings SET status='cancelled' WHERE organization_id=1 AND id=?")
      .bind(bookingId).run();
    const order=orderFor(raw,1,bookingId);
    assert.equal(order.state,"cancelled");

    assert.throws(()=>raw.prepare(
      `INSERT INTO business_documents
       (organization_id,document_type,number,occurred_at,state,comment,created_by,basis_document_id)
       VALUES (1,'payment','ОП-AFTER-CANCEL',CURRENT_TIMESTAMP,'draft','must fail','lifecycle@example.com',?)`
    ).run(order.id),/business_document_basis_cancelled/);
  });
});
