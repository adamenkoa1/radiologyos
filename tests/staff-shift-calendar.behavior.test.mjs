import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
function get(path, cookie) { return jsonRequest(path, undefined, {method:"GET",headers:{cookie}}); }
function post(path, cookie, body) { return jsonRequest(path, body, {method:"POST",headers:{cookie}}); }

async function addOrgTwo(db) {
  await db.prepare("INSERT OR IGNORE INTO organizations (id, slug, name, active) VALUES (2, 'shift-org-two', 'Shift Org Two', 1)").run();
}

async function seedScopedStaffSession(db, options) {
  const organizationId = Number(options.organizationId || 1);
  const cookie = await seedStaffSession(db, {...options,withMembership:false});
  const existing = await db.prepare(
    `SELECT 1 AS ok FROM memberships WHERE organization_id = ? AND member_email = ? LIMIT 1`
  ).bind(organizationId, options.email).first();
  if (existing) {
    await db.prepare("UPDATE memberships SET role = ?, active = 1 WHERE organization_id = ? AND member_email = ?")
      .bind(options.role, organizationId, options.email).run();
  } else {
    await db.prepare("INSERT INTO memberships (organization_id, member_email, role, active) VALUES (?, ?, ?, 1)")
      .bind(organizationId, options.email, options.role).run();
  }
  return cookie;
}

async function ensurePersonnel(db, {organizationId=1,email=null,displayName="Працівник",positionTitle="Лікар-рентгенолог",id}) {
  const personnelId = id || `personnel-test-${organizationId}-${String(email || displayName).replace(/[^a-z0-9]+/gi,"-").toLowerCase()}`;
  await db.prepare(`
    INSERT OR IGNORE INTO personnel_records
      (id, organization_id, account_email, display_name, position_title, active, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, 1, 'test', 'test')
  `).bind(personnelId, organizationId, email, displayName, positionTitle).run();
  return personnelId;
}

test("Calendar6 port keeps the eight source schedule types and exact matrix concepts", async () => {
  const source = await read("lib/shift-calendar.ts");
  for (let index=1; index<=8; index+=1) assert.match(source, new RegExp(`code:"calendar6-${index}"`));
  assert.match(source, /День — ніч — троє вдома/);
  assert.match(source, /Два дні через два/);
  assert.match(source, /Доба — троє/);
  assert.match(source, /День — ніч — 48/);
  assert.match(source, /Три зміни на добу/);
  assert.match(source, /2 день — 2 ніч — 3 вдома/);
  assert.match(source, /2 день — 2 вихідні — 2 ніч — 2 вихідні/);
  assert.match(source, /sourceWarning/);
  assert.match(source, /resolvePresetShift/);
});

test("staff shift calendar is personnel keyed, tenant scoped, self scoped for clinicians, and manager writable", async () => {
  await withD1(async (db) => {
    await addOrgTwo(db);
    const adminCookie = await seedStaffSession(db, {email:"shift-admin@example.com",role:"admin",displayName:"Shift Admin",organizationId:1});
    await ensurePersonnel(db,{email:"shift-admin@example.com",displayName:"Shift Admin",positionTitle:"Адміністратор"});

    await seedStaffSession(db,{email:"doctor-one@example.com",role:"radiologist",displayName:"Doctor One",organizationId:1});
    const doctorOneId = await ensurePersonnel(db,{email:"doctor-one@example.com",displayName:"Doctor One"});

    await seedStaffSession(db,{email:"doctor-two@example.com",role:"radiologist",displayName:"Doctor Two",organizationId:2});
    const doctorTwoId = await ensurePersonnel(db,{organizationId:2,email:"doctor-two@example.com",displayName:"Doctor Two"});

    const doctorCookie = await seedStaffSession(db,{email:"doctor-self@example.com",role:"radiologist",displayName:"Doctor Self",organizationId:1});
    const doctorSelfId = await ensurePersonnel(db,{email:"doctor-self@example.com",displayName:"Doctor Self"});

    const accountlessId = await ensurePersonnel(db,{email:null,displayName:"Accountless Radiographer",positionTitle:"Рентгенолаборант",id:"personnel-accountless-shift"});

    const list = await callWorker(get("/api/staff/shifts?month=2026-08",adminCookie),db);
    assert.equal(list.status,200);
    const listBody = await list.json();
    assert.equal(listBody.canManage,true);
    assert.ok(listBody.people.some((row)=>row.personnelId===doctorOneId && row.email==="doctor-one@example.com"));
    assert.ok(listBody.people.some((row)=>row.personnelId===accountlessId && row.accountEmail===null));
    assert.ok(listBody.people.every((row)=>row.personnelId!==doctorTwoId));
    assert.equal(listBody.presets.length,8);

    const assign = await callWorker(post("/api/staff/shifts",adminCookie,{
      action:"assignment",personnelId:doctorOneId,presetCode:"calendar6-4",teamIndex:4,anchorDate:"2026-08-01",
    }),db);
    assert.equal(assign.status,200);

    const legacyCompatibility = await callWorker(post("/api/staff/shifts",adminCookie,{
      action:"assignment",staffEmail:"doctor-one@example.com",presetCode:"calendar6-4",teamIndex:4,anchorDate:"2026-08-01",
    }),db);
    assert.equal(legacyCompatibility.status,200);

    const accountlessAssign = await callWorker(post("/api/staff/shifts",adminCookie,{
      action:"assignment",personnelId:accountlessId,presetCode:"calendar6-3",teamIndex:1,anchorDate:"2026-08-01",
    }),db);
    assert.equal(accountlessAssign.status,200);

    const crossTenant = await callWorker(post("/api/staff/shifts",adminCookie,{
      action:"assignment",personnelId:doctorTwoId,presetCode:"calendar6-2",teamIndex:1,anchorDate:"2026-08-01",
    }),db);
    assert.equal(crossTenant.status,404);

    const override = await callWorker(post("/api/staff/shifts",adminCookie,{
      action:"override",personnelId:doctorOneId,shiftDate:"2026-08-03",kind:"leave",label:"Вп",
      startTime:"",endTime:"",note:"Планова відпустка",
    }),db);
    assert.equal(override.status,200);

    const updated = await callWorker(get("/api/staff/shifts?month=2026-08",adminCookie),db);
    const updatedBody = await updated.json();
    const doctorAssignment = updatedBody.assignments.find((row)=>row.personnelId===doctorOneId);
    assert.equal(doctorAssignment.staffEmail,"doctor-one@example.com");
    assert.equal(doctorAssignment.presetCode,"calendar6-4");
    assert.ok(updatedBody.assignments.some((row)=>row.personnelId===accountlessId && row.staffEmail===""));
    assert.equal(updatedBody.overrides.length,1);
    assert.equal(updatedBody.overrides[0].personnelId,doctorOneId);
    assert.equal(updatedBody.overrides[0].kind,"leave");

    const self = await callWorker(get("/api/staff/shifts?month=2026-08",doctorCookie),db);
    assert.equal(self.status,200);
    const selfBody = await self.json();
    assert.equal(selfBody.canManage,false);
    assert.equal(selfBody.personnelLinked,true);
    assert.deepEqual(selfBody.people.map((row)=>row.personnelId),[doctorSelfId]);
    assert.deepEqual(selfBody.assignments,[]);

    const denied = await callWorker(post("/api/staff/shifts",doctorCookie,{
      action:"assignment",personnelId:doctorSelfId,presetCode:"calendar6-2",teamIndex:1,anchorDate:"2026-08-01",
    }),db);
    assert.equal(denied.status,403);

    const csv = await callWorker(get("/api/staff/shifts?month=2026-08&format=csv",adminCookie),db);
    assert.equal(csv.status,200);
    assert.match(csv.headers.get("content-type") || "",/text\/csv/);
    const csvText = await csv.text();
    assert.match(csvText,/Doctor One/);
    assert.match(csvText,/Accountless Radiographer/);
    assert.doesNotMatch(csvText,/Doctor Two/);
    assert.match(csvText,/Вп/);
  });
});

test("department head can manage personnel shifts while organization admin stays control-plane only", async () => {
  await withD1(async (db) => {
    const headCookie = await seedScopedStaffSession(db,{email:"shift-department-head@example.com",role:"department_head",displayName:"Department Head",organizationId:1});
    await ensurePersonnel(db,{email:"shift-department-head@example.com",displayName:"Department Head",positionTitle:"Начальник відділення"});
    await seedScopedStaffSession(db,{email:"shift-radiographer@example.com",role:"radiographer",displayName:"Radiographer",organizationId:1});
    const radiographerId = await ensurePersonnel(db,{email:"shift-radiographer@example.com",displayName:"Radiographer",positionTitle:"Рентгенолаборант"});
    const sysCookie = await seedScopedStaffSession(db,{email:"shift-system-admin@example.com",role:"organization_admin",displayName:"System Admin",organizationId:1});
    await ensurePersonnel(db,{email:"shift-system-admin@example.com",displayName:"System Admin",positionTitle:"System Admin"});

    const headSave = await callWorker(post("/api/staff/shifts",headCookie,{
      action:"assignment",personnelId:radiographerId,presetCode:"calendar6-1",teamIndex:2,anchorDate:"2026-08-17",
    }),db);
    assert.equal(headSave.status,200);

    const sysSave = await callWorker(post("/api/staff/shifts",sysCookie,{
      action:"assignment",personnelId:radiographerId,presetCode:"calendar6-1",teamIndex:1,anchorDate:"2026-08-17",
    }),db);
    assert.equal(sysSave.status,403);

    const auditRows = await db.prepare(
      "SELECT action, organization_id AS organizationId FROM security_audit_log WHERE action LIKE 'staff_shift_%' ORDER BY id"
    ).all();
    assert.ok(auditRows.results.some((row)=>row.action==="staff_shift_assignment_saved" && row.organizationId===1));
  });
});