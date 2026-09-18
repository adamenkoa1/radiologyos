import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

const read=(p)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
const call=(db,cookie,url,body,method="GET")=>callWorker(jsonRequest(url,body,{method,headers:{cookie}}),db);

test("saved-view migration keys variants by tenant, member and surface",async()=>{
  const sql=await read("drizzle/0039_staff_saved_views.sql");
  assert.match(sql,/CREATE TABLE IF NOT EXISTS staff_saved_views/);
  assert.match(sql,/organization_id INTEGER NOT NULL/);
  assert.match(sql,/member_email TEXT NOT NULL/);
  assert.match(sql,/UNIQUE \(organization_id, member_email, surface, name\)/);
  assert.match(sql,/staff_saved_views_owner_surface_idx/);
});

test("staff saved views are personal and tenant scoped",async()=>{
  await withD1(async(db)=>{
    await db.prepare("INSERT INTO organizations (id,slug,name,active) VALUES (2,'other','Інша',1)").run();
    const owner=await seedStaffSession(db,{email:"owner@clinic.test",role:"radiologist",organizationId:1});
    const colleague=await seedStaffSession(db,{email:"colleague@clinic.test",role:"radiologist",organizationId:1});
    const otherTenant=await seedStaffSession(db,{email:"other@clinic.test",role:"radiologist",organizationId:2});

    const saved=await call(db,owner,"/api/staff/saved-views",{
      surface:"studies",name:"КТ очікує опису",config:{filter:"reporting",equipment:"ct",query:"Іваненко"},
    },"POST");
    assert.equal(saved.status,200);

    const ownData=await (await call(db,owner,"/api/staff/saved-views?surface=studies",undefined,"GET")).json();
    assert.equal(ownData.views.length,1);
    assert.deepEqual(ownData.views[0].config,{filter:"reporting",equipment:"ct"});

    const colleagueData=await (await call(db,colleague,"/api/staff/saved-views?surface=studies",undefined,"GET")).json();
    assert.equal(colleagueData.views.length,0);
    const tenantData=await (await call(db,otherTenant,"/api/staff/saved-views?surface=studies",undefined,"GET")).json();
    assert.equal(tenantData.views.length,0);

    const raw=await db.prepare("SELECT config_json AS configJson FROM staff_saved_views WHERE organization_id=1 AND member_email='owner@clinic.test'").first();
    assert.equal(raw.configJson,'{"filter":"reporting","equipment":"ct"}');
  });
});

test("a staff member cannot delete another member's saved view",async()=>{
  await withD1(async(db)=>{
    const owner=await seedStaffSession(db,{email:"owner-delete@clinic.test",role:"registrar"});
    const other=await seedStaffSession(db,{email:"other-delete@clinic.test",role:"registrar"});
    const saved=await (await call(db,owner,"/api/staff/saved-views",{
      surface:"studies",name:"Рентген готові",config:{filter:"completed",equipment:"xray"},
    },"POST")).json();
    const denied=await call(db,other,"/api/staff/saved-views",{surface:"studies",id:saved.id},"DELETE");
    assert.equal(denied.status,404);
    const stillThere=await db.prepare("SELECT COUNT(*) AS n FROM staff_saved_views WHERE id=?").bind(saved.id).first();
    assert.equal(stillThere.n,1);
  });
});

test("saved views API is deny-by-default and stores no free-text study search",async()=>{
  const route=await read("app/api/staff/saved-views/route.ts");
  assert.match(route,/requireOrgContext\(request,db\)/);
  assert.match(route,/WHERE organization_id=\? AND member_email=\? AND surface=\?/);
  assert.match(route,/DELETE FROM staff_saved_views WHERE id=\? AND organization_id=\? AND member_email=\? AND surface=\?/);
  assert.match(route,/type SavedConfig = \{ filter:string; equipment:string \}/);
  assert.doesNotMatch(route,/query:string/);
});

test("studies registry can save, apply and delete personal variants without persisting search text",async()=>{
  const page=await read("app/staff/studies/page.tsx");
  assert.match(page,/Мої варіанти…/);
  assert.match(page,/Зберегти варіант/);
  assert.match(page,/Видалити/);
  assert.match(page,/config:\{filter,equipment\}/);
  assert.match(page,/setQuery\(""\)/);
  assert.match(page,/текст пошуку не зберігається/);
  assert.doesNotMatch(page,/config:\{filter,equipment,query\}/);
});
