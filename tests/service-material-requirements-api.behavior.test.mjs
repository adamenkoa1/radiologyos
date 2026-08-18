import assert from "node:assert/strict";
import test from "node:test";
import { callWorker,jsonRequest,seedStaffSession,withD1 } from "./helpers/d1.mjs";

async function api(db,url,cookie,body,method="POST"){
  return callWorker(jsonRequest(url,body,{method,headers:{cookie}}),db);
}
async function get(db,url,cookie){return callWorker(new Request(`http://localhost${url}`,{headers:{cookie}}),db);}
async function seedItem(db,organizationId,sku){
  const result=await db.prepare(`INSERT INTO inventory_items (organization_id,sku,name,category,unit,min_stock,active)
    VALUES (?,?,'Контрастний матеріал','contrast','мл',0,1)`).bind(organizationId,sku).run();
  return Number(result.meta.last_row_id);
}
async function defaultWarehouse(db,organizationId){
  const row=await db.prepare("SELECT id FROM warehouses WHERE organization_id=? AND is_default=1 LIMIT 1").bind(organizationId).first();
  assert.ok(row?.id);return Number(row.id);
}

test("service material requirement API is tenant scoped, admin-write only, versioned and PHI-free audited",async()=>{
  await withD1(async(db,raw)=>{
    const admin=await seedStaffSession(db,{email:"materials-admin@example.com",role:"admin",organizationId:1});
    const registrar=await seedStaffSession(db,{email:"materials-reg@example.com",role:"registrar",organizationId:1});
    const itemId=await seedItem(db,1,"MAT-API-1");
    const warehouseId=await defaultWarehouse(db,1);

    const createdResponse=await api(db,"/api/staff/service-material-requirements",admin,{serviceCode:"401",itemId,warehouseId,quantity:25});
    assert.equal(createdResponse.status,201);const created=await createdResponse.json();
    assert.equal(created.requirement.serviceCode,"401");assert.equal(created.requirement.itemId,itemId);
    assert.equal(created.requirement.warehouseId,warehouseId);assert.equal(Number(created.requirement.quantity),25);
    assert.equal(created.requirement.active,1);assert.ok(created.requirement.serviceTitle);

    const staffRead=await get(db,"/api/staff/service-material-requirements?active=1&serviceCode=401",registrar);
    assert.equal(staffRead.status,200);const staffBody=await staffRead.json();
    assert.equal(staffBody.canEdit,false);assert.equal(staffBody.requirements.length,1);
    assert.equal(staffBody.requirements[0].id,created.requirement.id);

    const forbiddenCreate=await api(db,"/api/staff/service-material-requirements",registrar,{serviceCode:"401",itemId,warehouseId,quantity:10});
    assert.equal(forbiddenCreate.status,403);
    const duplicate=await api(db,"/api/staff/service-material-requirements",admin,{serviceCode:"401",itemId,warehouseId,quantity:30});
    assert.equal(duplicate.status,409);
    const invalidService=await api(db,"/api/staff/service-material-requirements",admin,{serviceCode:"NOPE",itemId,warehouseId,quantity:30});
    assert.equal(invalidService.status,400);

    const forbiddenDeactivate=await api(db,"/api/staff/service-material-requirements",registrar,{id:created.requirement.id},"PATCH");
    assert.equal(forbiddenDeactivate.status,403);
    const deactivatedResponse=await api(db,"/api/staff/service-material-requirements",admin,{id:created.requirement.id},"PATCH");
    assert.equal(deactivatedResponse.status,200);const deactivated=await deactivatedResponse.json();
    assert.equal(deactivated.requirement.active,0);

    const replacementResponse=await api(db,"/api/staff/service-material-requirements",admin,{serviceCode:"401",itemId,warehouseId,quantity:30});
    assert.equal(replacementResponse.status,201);const replacement=await replacementResponse.json();
    assert.notEqual(replacement.requirement.id,created.requirement.id);
    assert.equal(Number(replacement.requirement.quantity),30);
    assert.throws(()=>raw.prepare("UPDATE service_material_requirements SET quantity=99 WHERE id=?").run(created.requirement.id),/service_material_requirement_immutable/);

    const auditRows=raw.prepare(`SELECT action,details_json AS detailsJson FROM security_audit_log
      WHERE organization_id=1 AND action IN ('service_material_requirement_created','service_material_requirement_deactivated') ORDER BY id`).all();
    assert.equal(auditRows.length,3);
    for(const row of auditRows){
      const details=JSON.parse(row.detailsJson);const keys=Object.keys(details).sort();
      assert.ok(keys.every(key=>["itemId","quantity","serviceCode","warehouseId"].includes(key)));
      assert.equal(row.detailsJson.includes("patient"),false);assert.equal(row.detailsJson.includes("booking"),false);
    }
  });
});

test("service material requirement API rejects cross-tenant references and never leaks another tenant",async()=>{
  await withD1(async(db)=>{
    const org2Result=await db.prepare("INSERT INTO organizations (slug,name,active) VALUES ('materials-org-2','Materials Org 2',1)").run();
    const org2=Number(org2Result.meta.last_row_id);assert.ok(org2>1);
    const admin1=await seedStaffSession(db,{email:"materials-org1@example.com",role:"admin",organizationId:1});
    const admin2=await seedStaffSession(db,{email:"materials-org2@example.com",role:"admin",organizationId:org2});
    const item1=await seedItem(db,1,"MAT-ORG1");const warehouse1=await defaultWarehouse(db,1);
    const item2=await seedItem(db,org2,"MAT-ORG2");const warehouse2=await defaultWarehouse(db,org2);

    assert.equal((await api(db,"/api/staff/service-material-requirements",admin1,{serviceCode:"401",itemId:item1,warehouseId:warehouse1,quantity:1})).status,201);
    assert.equal((await api(db,"/api/staff/service-material-requirements",admin1,{serviceCode:"401",itemId:item2,warehouseId:warehouse1,quantity:1})).status,409);
    assert.equal((await api(db,"/api/staff/service-material-requirements",admin1,{serviceCode:"401",itemId:item1,warehouseId:warehouse2,quantity:1})).status,409);

    const org2List=await get(db,"/api/staff/service-material-requirements",admin2);assert.equal(org2List.status,200);
    const org2Body=await org2List.json();assert.equal(org2Body.requirements.length,0);
    assert.equal((await api(db,"/api/staff/service-material-requirements",admin2,{serviceCode:"401",itemId:item2,warehouseId:warehouse2,quantity:2})).status,201);
    const org1List=await get(db,"/api/staff/service-material-requirements",admin1);const org1Body=await org1List.json();
    assert.equal(org1Body.requirements.length,1);assert.equal(org1Body.requirements[0].organizationId,1);
  });
});
