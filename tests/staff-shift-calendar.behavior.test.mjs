import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function get(path, cookie) {
  return jsonRequest(path, undefined, { method:"GET", headers:{ cookie } });
}

function post(path, cookie, body) {
  return jsonRequest(path, body, { method:"POST", headers:{ cookie } });
}

async function addOrgTwo(db) {
  await db.prepare(
    "INSERT OR IGNORE INTO organizations (id, slug, name, active) VALUES (2, 'shift-org-two', 'Shift Org Two', 1)"
  ).run();
}

test("Calendar6 port keeps the eight source schedule types and exact matrix concepts", async () => {
  const source = await read("lib/shift-calendar.ts");
  for (let index = 1; index <= 8; index += 1) {
    assert.match(source, new RegExp(`code:"calendar6-${index}"`));
  }
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

test("staff shift calendar is tenant scoped, self scoped for clinicians, and manager writable", async () => {
  await withD1(async (db) => {
    await addOrgTwo(db);
    const adminCookie = await seedStaffSession(db, {
      email:"shift-admin@example.com", role:"admin", displayName:"Shift Admin", organizationId:1,
    });
    await seedStaffSession(db, {
      email:"doctor-one@example.com", role:"radiologist", displayName:"Doctor One", organizationId:1,
    });
    await seedStaffSession(db, {
      email:"doctor-two@example.com", role:"radiologist", displayName:"Doctor Two", organizationId:2,
    });
    const doctorCookie = await seedStaffSession(db, {
      email:"doctor-self@example.com", role:"radiologist", displayName:"Doctor Self", organizationId:1,
    });

    const list = await callWorker(get("/api/staff/shifts?month=2026-08", adminCookie), db);
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.equal(listBody.canManage, true);
    assert.ok(listBody.people.some((row) => row.email === "doctor-one@example.com"));
    assert.ok(listBody.people.every((row) => row.email !== "doctor-two@example.com"));
    assert.equal(listBody.presets.length, 8);

    const assign = await callWorker(post("/api/staff/shifts", adminCookie, {
      action:"assignment",
      staffEmail:"doctor-one@example.com",
      presetCode:"calendar6-4",
      teamIndex:4,
      anchorDate:"2026-08-01",
    }), db);
    assert.equal(assign.status, 200);

    const crossTenant = await callWorker(post("/api/staff/shifts", adminCookie, {
      action:"assignment",
      staffEmail:"doctor-two@example.com",
      presetCode:"calendar6-2",
      teamIndex:1,
      anchorDate:"2026-08-01",
    }), db);
    assert.equal(crossTenant.status, 404);

    const override = await callWorker(post("/api/staff/shifts", adminCookie, {
      action:"override",
      staffEmail:"doctor-one@example.com",
      shiftDate:"2026-08-03",
      kind:"leave",
      label:"Вп",
      startTime:"",
      endTime:"",
      note:"Планова відпустка",
    }), db);
    assert.equal(override.status, 200);

    const updated = await callWorker(get("/api/staff/shifts?month=2026-08", adminCookie), db);
    const updatedBody = await updated.json();
    assert.deepEqual(updatedBody.assignments, [{
      staffEmail:"doctor-one@example.com",
      presetCode:"calendar6-4",
      teamIndex:4,
      anchorDate:"2026-08-01",
    }]);
    assert.equal(updatedBody.overrides.length, 1);
    assert.equal(updatedBody.overrides[0].kind, "leave");

    const self = await callWorker(get("/api/staff/shifts?month=2026-08", doctorCookie), db);
    assert.equal(self.status, 200);
    const selfBody = await self.json();
    assert.equal(selfBody.canManage, false);
    assert.deepEqual(selfBody.people.map((row) => row.email), ["doctor-self@example.com"]);
    assert.deepEqual(selfBody.assignments, []);

    const denied = await callWorker(post("/api/staff/shifts", doctorCookie, {
      action:"assignment",
      staffEmail:"doctor-self@example.com",
      presetCode:"calendar6-2",
      teamIndex:1,
      anchorDate:"2026-08-01",
    }), db);
    assert.equal(denied.status, 403);

    const csv = await callWorker(get("/api/staff/shifts?month=2026-08&format=csv", adminCookie), db);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") || "", /text\/csv/);
    const csvText = await csv.text();
    assert.match(csvText, /Doctor One/);
    assert.doesNotMatch(csvText, /Doctor Two/);
    assert.match(csvText, /Вп/);
  });
});

test("department head can manage staff shifts while organization admin stays control-plane only", async () => {
  await withD1(async (db) => {
    const headCookie = await seedStaffSession(db, {
      email:"head@example.com", role:"department_head", displayName:"Department Head", organizationId:1,
    });
    await seedStaffSession(db, {
      email:"radiographer@example.com", role:"radiographer", displayName:"Radiographer", organizationId:1,
    });
    const sysCookie = await seedStaffSession(db, {
      email:"sys@example.com", role:"organization_admin", displayName:"System Admin", organizationId:1,
    });

    const headSave = await callWorker(post("/api/staff/shifts", headCookie, {
      action:"assignment",
      staffEmail:"radiographer@example.com",
      presetCode:"calendar6-1",
      teamIndex:2,
      anchorDate:"2026-08-17",
    }), db);
    assert.equal(headSave.status, 200);

    const sysSave = await callWorker(post("/api/staff/shifts", sysCookie, {
      action:"assignment",
      staffEmail:"radiographer@example.com",
      presetCode:"calendar6-1",
      teamIndex:1,
      anchorDate:"2026-08-17",
    }), db);
    assert.equal(sysSave.status, 403);

    const auditRows = await db.prepare(
      `SELECT action, organization_id AS organizationId
       FROM audit_log WHERE action LIKE 'staff_shift_%' ORDER BY id`
    ).all();
    assert.ok(auditRows.results.some((row) => row.action === "staff_shift_assignment_saved" && row.organizationId === 1));
  });
});
