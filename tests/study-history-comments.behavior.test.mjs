import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1,jsonRequest,callWorker,seedStaffSession } from "./helpers/d1.mjs";

const read=(p)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");

async function booking(db,{id,org=1,code,assignedRad="",assignedTech=""}){
  await db.prepare(`INSERT INTO bookings (id,organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,duration_minutes,desired_date,desired_time,status,date_of_birth,patient_category,assigned_radiologist_email,assigned_radiographer_email)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,org,code,"Тестовий Пацієнт","+380971110000",`38097111${String(id).padStart(4,"0")}`,"КТ","CT-01","ct",30,"2026-09-02",`${10+(id%6)}:00`,"confirmed","1990-01-01","civilian",assignedRad,assignedTech).run();
}

const getContext=(db,cookie,id)=>callWorker(jsonRequest(`/api/staff/study-context?id=${id}`,undefined,{method:"GET",headers:{cookie}}),db);
const addComment=(db,cookie,id,text)=>callWorker(jsonRequest("/api/staff/study-context",{id,text},{method:"POST",headers:{cookie}}),db);

test("study comments are tenant scoped and audit does not copy comment text",async()=>{
  await withD1(async(db)=>{
    await db.prepare("INSERT INTO organizations (id,slug,name,active) VALUES (2,'org-two','Org Two',1)").run();
    await booking(db,{id:801,org:1,code:"RD-HIST801"});
    await booking(db,{id:803,org:2,code:"RD-HIST803"});
    const org1=await seedStaffSession(db,{email:"admin-history@org1.test",role:"admin",organizationId:1});
    const org2=await seedStaffSession(db,{email:"admin-history@org2.test",role:"admin",organizationId:2});
    const secret="Клінічне уточнення, яке не повинно копіюватися в audit";

    const created=await addComment(db,org1,801,secret);
    assert.equal(created.status,201);
    const own=await (await getContext(db,org1,801)).json();
    assert.equal(own.comments.length,1);
    assert.equal(own.comments[0].body,secret);
    assert.equal((await getContext(db,org2,801)).status,404);

    const audit=await db.prepare("SELECT details_json AS details FROM security_audit_log WHERE organization_id=1 AND action='study_comment_added' ORDER BY id DESC LIMIT 1").first();
    assert.ok(audit?.details);
    assert.doesNotMatch(audit.details,/Клінічне уточнення/);
  });
});

test("clinicians can only read and comment on studies assigned to them",async()=>{
  await withD1(async(db)=>{
    const email="rad-history@likarnya.test";
    await booking(db,{id:811,code:"RD-RAD811",assignedRad:email});
    await booking(db,{id:812,code:"RD-RAD812",assignedRad:"other@likarnya.test"});
    const cookie=await seedStaffSession(db,{email,role:"radiologist"});
    assert.equal((await getContext(db,cookie,811)).status,200);
    assert.equal((await getContext(db,cookie,812)).status,404);
    assert.equal((await addComment(db,cookie,811,"Уточнення лікаря")).status,201);
    assert.equal((await addComment(db,cookie,812,"Не має пройти")).status,404);
  });
});

test("study comments are append-only and use existing booking history",async()=>{
  const [route,migration,page,drawer]=await Promise.all([
    read("app/api/staff/study-context/route.ts"),read("drizzle/0040_booking_comments.sql"),
    read("app/staff/studies/page.tsx"),read("app/staff/studies/study-context-drawer.tsx"),
  ]);
  assert.match(route,/canAccessBooking\(db,ctx\.member,id,ctx\.organizationId\)/);
  assert.match(route,/booking_events/);
  assert.match(route,/booking_staff_notes/);
  assert.match(route,/study_comment_added/);
  assert.doesNotMatch(route,/export async function (DELETE|PATCH)/);
  assert.match(migration,/organization_id INTEGER NOT NULL/);
  assert.match(migration,/booking_comments_org_booking_idx/);
  assert.match(page,/StudyContextDrawer/);
  assert.match(page,/>Історія<\/button>/);
  assert.match(drawer,/Події workflow/);
  assert.match(drawer,/Новий коментар/);
});
