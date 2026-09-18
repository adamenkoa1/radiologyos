import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

test("cash account type and currency are immutable business identity",async()=>{
  await withD1(async(db,raw)=>{
    const cookie=await seedStaffSession(db,{email:"cash-identity@example.com",role:"admin",organizationId:1});
    const account=raw.prepare("SELECT id FROM cash_accounts WHERE organization_id=1 AND code='BANK-UAH'").get();
    const api=await callWorker(jsonRequest("/api/staff/cash-accounts",{id:account.id,accountType:"cash"},{method:"PATCH",headers:{cookie}}),db);
    assert.equal(api.status,409);
    assert.match((await api.json()).error,/Тип і валюту/i);
    assert.throws(()=>raw.prepare("UPDATE cash_accounts SET currency='USD' WHERE organization_id=1 AND id=?").run(account.id),/cash_account_classification_immutable/);
    assert.throws(()=>raw.prepare("UPDATE cash_accounts SET account_type='cash' WHERE organization_id=1 AND id=?").run(account.id),/cash_account_classification_immutable/);
  });
});
