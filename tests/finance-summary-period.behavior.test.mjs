// Фінансовий журнал: підсумки походять із усього cash-регістру (SUM у SQL, а не
// з урізаного вікна сторінки), розбиті за валютами; фільтр періоду Від/До скоупить
// і журнал, і підсумки на сервері.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{code="RD-SUM-001",amount=2400,phone="380501112233",organizationId=1}={}) {
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
      duration_minutes,desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status
     ) VALUES (?,?,'Пацієнт Підсумок','+380501112233',?,'КТ ОГК','ct-chest','ct',30,
       '2026-08-20','10:00','civilian','pending',?,0,'confirmed')`
  ).bind(organizationId,code,phone,amount).run();
  return Number(result.meta.last_row_id);
}
const pay=(db,cookie,bookingId,reference="SUM-REF-001")=>
  callWorker(jsonRequest("/api/staff/payments",{bookingId,method:"bank_transfer",providerReference:reference},{headers:{cookie}}),db);
const refund=(db,cookie,bookingId)=>
  callWorker(new Request("http://localhost/api/staff/payments",{method:"DELETE",headers:{"content-type":"application/json",cookie},body:JSON.stringify({bookingId})}),db);
const financeGet=(db,cookie,search="")=>
  callWorker(new Request(`http://localhost/api/staff/finance${search}`,{headers:{cookie}}),db);

test("finance summary sums the whole cash register per currency, not the loaded window",async()=>{
  await withD1(async(db)=>{
    const bookingId=await seedBooking(db);
    const cookie=await seedStaffSession(db,{email:"summary@example.com",role:"registrar",organizationId:1});
    assert.equal((await pay(db,cookie,bookingId)).status,200);

    const response=await financeGet(db,cookie);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.ok(Array.isArray(body.summary));
    const uah=body.summary.find((row)=>row.currency==="UAH");
    assert.ok(uah,"є рядок підсумку в UAH");
    assert.equal(uah.incoming,2400);
    assert.equal(uah.outgoing,0);
    assert.equal(uah.net,2400);
    assert.equal(uah.movements,1);
    assert.deepEqual(body.period,{from:"",to:""});
  });
});

test("refund shows up in the register summary as outgoing",async()=>{
  await withD1(async(db)=>{
    const bookingId=await seedBooking(db,{code:"RD-SUM-REFUND",amount:3100});
    const cookie=await seedStaffSession(db,{email:"summary-refund@example.com",role:"registrar",organizationId:1});
    assert.equal((await pay(db,cookie,bookingId,"SUM-REFUND")).status,200);
    assert.equal((await refund(db,cookie,bookingId)).status,200);

    const body=await(await financeGet(db,cookie)).json();
    const uah=body.summary.find((row)=>row.currency==="UAH");
    assert.equal(uah.incoming,3100);
    assert.equal(uah.outgoing,3100);
    assert.equal(uah.net,0);
    assert.equal(uah.movements,2);
  });
});

test("period filter scopes the journal and the summary on the server",async()=>{
  await withD1(async(db)=>{
    const bookingId=await seedBooking(db,{code:"RD-SUM-PERIOD",amount:1500});
    const cookie=await seedStaffSession(db,{email:"summary-period@example.com",role:"registrar",organizationId:1});
    assert.equal((await pay(db,cookie,bookingId,"SUM-PERIOD")).status,200);

    const past=await(await financeGet(db,cookie,"?from=2000-01-01&to=2000-12-31")).json();
    assert.equal(past.documents.length,0);
    assert.equal(past.cashMovements.length,0);
    assert.equal(past.summary.length,0);
    assert.deepEqual(past.period,{from:"2000-01-01",to:"2000-12-31"});

    const wide=await(await financeGet(db,cookie,"?from=2026-01-01&to=2026-12-31")).json();
    assert.equal(wide.documents.length,1);
    assert.equal(wide.summary.find((row)=>row.currency==="UAH").net,1500);
  });
});

test("finance page renders the server summary and offers a period filter",async()=>{
  const page=await readFile(new URL("../app/staff/finance/page.tsx",import.meta.url),"utf8");
  assert.match(page,/data\?\.summary\|\|\[\]/);
  assert.match(page,/money\(primary\.incoming,primary\.currency\)/);
  assert.match(page,/type="date"/);
  assert.match(page,/aria-label="Період: від"/);
  assert.match(page,/aria-label="Період: до"/);
  assert.match(page,/if\(from&&to&&from>to\)/);
});
