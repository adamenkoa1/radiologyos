import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function seedBooking(db,{code="RD-CASH-001",amount=2500,organizationId=1,time="10:00"}={}){
  const result=await db.prepare(
    `INSERT INTO bookings (
      organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,duration_minutes,
      desired_date,desired_time,patient_category,payment_status,payment_amount,paid_amount,status
     ) VALUES (?,?,'Пацієнт Каса','+380501112233','380501112233','КТ ОГК','ct-chest','ct',30,
       '2026-08-25',?,'civilian','pending',?,0,'confirmed')`
  ).bind(organizationId,code,time,amount).run();
  return Number(result.meta.last_row_id);
}

async function pay(db,cookie,bookingId,{method="bank_transfer",reference="CASH-REF",cashAccountId=null}={}){
  return callWorker(jsonRequest("/api/staff/payments",{bookingId,method,providerReference:reference,...(cashAccountId?{cashAccountId}:{})},{headers:{cookie}}),db);
}

async function refund(db,cookie,bookingId){
  return callWorker(new Request("http://localhost/api/staff/payments",{method:"DELETE",headers:{"content-type":"application/json",cookie},body:JSON.stringify({bookingId})}),db);
}

test("cash account directory seeds default cash and bank for existing and future tenants",async()=>{
  await withD1(async(db,raw)=>{
    const defaults=raw.prepare("SELECT code,account_type AS type,currency,is_default AS isDefault FROM cash_accounts WHERE organization_id=1 ORDER BY code").all();
    assert.deepEqual(defaults.map(row=>row.code),["BANK-UAH","CASH-UAH"]);
    assert.ok(defaults.every(row=>row.currency==="UAH"&&row.isDefault===1));
    raw.exec("INSERT INTO organizations (id,name,slug,active) VALUES (2,'Cash Org 2','cash-org-2',1)");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM cash_accounts WHERE organization_id=2").get().n,2);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM cash_accounts WHERE organization_id=2 AND is_default=1").get().n,2);

    const admin=await seedStaffSession(db,{email:"cash-admin@example.com",role:"admin",organizationId:1});
    const registrar=await seedStaffSession(db,{email:"cash-reg@example.com",role:"registrar",organizationId:1});
    const doctor=await seedStaffSession(db,{email:"cash-doc@example.com",role:"radiologist",organizationId:1});
    assert.equal((await callWorker(new Request("http://localhost/api/staff/cash-accounts",{headers:{cookie:admin}}),db)).status,200);
    assert.equal((await callWorker(new Request("http://localhost/api/staff/cash-accounts",{headers:{cookie:registrar}}),db)).status,200);
    assert.equal((await callWorker(new Request("http://localhost/api/staff/cash-accounts",{headers:{cookie:doctor}}),db)).status,403);
    assert.equal((await callWorker(jsonRequest("/api/staff/cash-accounts",{name:"Заборонена каса",accountType:"cash",currency:"UAH"},{headers:{cookie:registrar}}),db)).status,403);
  });
});

test("manual cash and bank payments post to the correct default account snapshot",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"cash-pay@example.com",role:"registrar",organizationId:1});
    const cashBooking=await seedBooking(db,{code:"RD-CASH-METHOD",amount:1200,time:"10:00"});
    const bankBooking=await seedBooking(db,{code:"RD-BANK-METHOD",amount:1300,time:"11:00"});
    const cashResponse=await pay(db,cookie,cashBooking,{method:"cash",reference:"CASH-METHOD"});assert.equal(cashResponse.status,200);
    const cashBody=await cashResponse.json();
    const bankResponse=await pay(db,cookie,bankBooking,{method:"bank_transfer",reference:"BANK-METHOD"});assert.equal(bankResponse.status,200);
    const bankBody=await bankResponse.json();
    const cash=raw.prepare("SELECT cash_account_id AS id,cash_account_name AS name,cash_account_code AS code FROM finance_document_details WHERE document_id=?").get(cashBody.documentId);
    const bank=raw.prepare("SELECT cash_account_id AS id,cash_account_name AS name,cash_account_code AS code FROM finance_document_details WHERE document_id=?").get(bankBody.documentId);
    assert.equal(cash.code,"CASH-UAH");assert.equal(cash.name,"Основна каса");
    assert.equal(bank.code,"BANK-UAH");assert.equal(bank.name,"Основний банківський рахунок");
    const cashMovement=raw.prepare("SELECT cash_account_id AS id,cash_account_name AS name,cash_account_code AS code FROM cash_movements WHERE document_id=?").get(cashBody.documentId);
    assert.deepEqual(cashMovement,cash);
  });
});

test("explicit payment account is tenant/currency scoped and exact cash registrar rejects a forged account",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("INSERT INTO organizations (id,name,slug,active) VALUES (2,'Foreign Cash Org','foreign-cash-org',1)");
    const cookie=await seedStaffSession(db,{email:"cash-explicit@example.com",role:"registrar",organizationId:1});
    const bookingId=await seedBooking(db,{code:"RD-CASH-EXPLICIT",amount:1400});
    const foreign=raw.prepare("SELECT id FROM cash_accounts WHERE organization_id=2 AND code='BANK-UAH'").get();
    const rejected=await pay(db,cookie,bookingId,{method:"bank_transfer",reference:"FOREIGN-ACCOUNT",cashAccountId:foreign.id});
    assert.equal(rejected.status,409);
    assert.match((await rejected.json()).error,/не знайдено|неактивний|валют/i);

    const local=raw.prepare("SELECT id FROM cash_accounts WHERE organization_id=1 AND code='BANK-UAH'").get();
    const paid=await pay(db,cookie,bookingId,{method:"bank_transfer",reference:"LOCAL-ACCOUNT",cashAccountId:local.id});assert.equal(paid.status,200);
    const body=await paid.json();
    const detail=raw.prepare("SELECT * FROM finance_document_details WHERE document_id=?").get(body.documentId);
    const other=raw.prepare("SELECT id,name,code FROM cash_accounts WHERE organization_id=1 AND code='CASH-UAH'").get();
    assert.throws(()=>raw.prepare(
      `INSERT INTO cash_movements
       (organization_id,document_id,booking_id,movement_type,amount_delta,currency,method,provider,provider_reference,
        cash_account_id,cash_account_name,cash_account_code,actor_email,occurred_at)
       VALUES (1,?,?,'payment',?,'UAH','bank_transfer','manual','LOCAL-ACCOUNT',?,?,?,'forged@example.com',CURRENT_TIMESTAMP)`
    ).run(body.documentId,bookingId,detail.amount,other.id,other.name,other.code),/cash_movement_document_mismatch/);
  });
});

test("refund keeps the original payment account snapshot after rename, deactivation and default switch",async()=>{
  await withD1(async(db,raw)=>{
    const admin=await seedStaffSession(db,{email:"cash-refund-admin@example.com",role:"admin",organizationId:1});
    const registrar=await seedStaffSession(db,{email:"cash-refund-reg@example.com",role:"registrar",organizationId:1});
    const original=raw.prepare("SELECT id,name,code FROM cash_accounts WHERE organization_id=1 AND code='BANK-UAH'").get();
    const bookingId=await seedBooking(db,{code:"RD-CASH-REFUND",amount:3200});
    const paid=await pay(db,registrar,bookingId,{method:"bank_transfer",reference:"REFUND-ACCOUNT",cashAccountId:original.id});assert.equal(paid.status,200);
    const paidBody=await paid.json();

    const created=await callWorker(jsonRequest("/api/staff/cash-accounts",{name:"Резервний банк",code:"BANK-RESERVE",accountType:"bank",currency:"UAH",active:true,isDefault:true},{headers:{cookie:admin}}),db);
    assert.equal(created.status,201);
    const changed=await callWorker(jsonRequest("/api/staff/cash-accounts",{id:original.id,name:"Стара каса банку (закрита)",active:false,isDefault:false},{method:"PATCH",headers:{cookie:admin}}),db);
    assert.equal(changed.status,200);

    const returned=await refund(db,registrar,bookingId);assert.equal(returned.status,200);const refundBody=await returned.json();
    const paymentDetail=raw.prepare("SELECT cash_account_id AS id,cash_account_name AS name,cash_account_code AS code FROM finance_document_details WHERE document_id=?").get(paidBody.documentId);
    const refundDetail=raw.prepare("SELECT cash_account_id AS id,cash_account_name AS name,cash_account_code AS code FROM finance_document_details WHERE document_id=?").get(refundBody.documentId);
    assert.deepEqual(refundDetail,paymentDetail);
    assert.equal(refundDetail.name,"Основний банківський рахунок");
    assert.equal(refundDetail.code,"BANK-UAH");
    const movement=raw.prepare("SELECT cash_account_id AS id,cash_account_name AS name,cash_account_code AS code,amount_delta AS amount FROM cash_movements WHERE document_id=?").get(refundBody.documentId);
    assert.equal(movement.id,original.id);assert.equal(movement.name,"Основний банківський рахунок");assert.equal(movement.amount,-3200);
  });
});

test("payment receipt snapshots account identity and first historical print survives account rename",async()=>{
  await withD1(async(db,raw)=>{
    const admin=await seedStaffSession(db,{email:"cash-print-admin@example.com",role:"admin",organizationId:1});
    const registrar=await seedStaffSession(db,{email:"cash-print-reg@example.com",role:"registrar",organizationId:1});
    const account=raw.prepare("SELECT id FROM cash_accounts WHERE organization_id=1 AND code='CASH-UAH'").get();
    const bookingId=await seedBooking(db,{code:"RD-CASH-PRINT",amount:900});
    const paid=await pay(db,registrar,bookingId,{method:"cash",reference:"CASH-PRINT",cashAccountId:account.id});const paidBody=await paid.json();
    const rename=await callWorker(jsonRequest("/api/staff/cash-accounts",{id:account.id,name:"Каса перейменована"},{method:"PATCH",headers:{cookie:admin}}),db);assert.equal(rename.status,200);
    const first=await callWorker(jsonRequest("/api/staff/finance/print",{documentId:paidBody.documentId},{headers:{cookie:registrar}}),db);assert.equal(first.status,201);const form1=await first.json();
    assert.equal(form1.snapshot.templateVersion,2);assert.equal(form1.payload.cashAccount.name,"Основна каса");assert.equal(form1.payload.cashAccount.code,"CASH-UAH");
    const again=await callWorker(jsonRequest("/api/staff/finance/print",{documentId:paidBody.documentId},{headers:{cookie:registrar}}),db);assert.equal(again.status,200);const form2=await again.json();
    assert.equal(form2.snapshot.id,form1.snapshot.id);assert.equal(form2.payload.cashAccount.name,"Основна каса");
  });
});
