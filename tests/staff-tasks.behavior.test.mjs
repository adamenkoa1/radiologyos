import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

test("staff tasks are tenant scoped and assignees must be active tenant members", async () => {
  await withD1(async (db, raw) => {
    raw.exec("INSERT OR IGNORE INTO organizations (id, name, slug, active) VALUES (2, 'Org 2', 'org-2', 1)");

    const org1Cookie = await seedStaffSession(db, { email:"one@example.com", role:"admin", organizationId:1 });
    const org2Cookie = await seedStaffSession(db, { email:"two@example.com", role:"admin", organizationId:2 });
    await seedStaffSession(db, { email:"worker2@example.com", role:"radiologist", organizationId:2 });

    const create = await callWorker(jsonRequest("/api/staff/tasks", {
      title:"Описати контрольне КТ",
      details:"До кінця зміни",
      priority:"high",
      dueDate:"2026-08-15",
      assignedEmail:"worker2@example.com",
    }, { headers:{ cookie:org2Cookie } }), db);
    assert.equal(create.status, 201);
    const created = await create.json();
    assert.ok(created.id > 0);

    const org2Row = raw.prepare("SELECT organization_id, assigned_email, title FROM staff_tasks WHERE id = ?").get(created.id);
    assert.equal(org2Row.organization_id, 2);
    assert.equal(org2Row.assigned_email, "worker2@example.com");

    const org1List = await callWorker(new Request("http://localhost/api/staff/tasks", { headers:{ cookie:org1Cookie } }), db);
    assert.equal(org1List.status, 200);
    const org1Payload = await org1List.json();
    assert.equal(org1Payload.tasks.some((t) => t.id === created.id), false);

    const crossAssign = await callWorker(jsonRequest("/api/staff/tasks", {
      title:"Не повинно створитися",
      assignedEmail:"worker2@example.com",
    }, { headers:{ cookie:org1Cookie } }), db);
    assert.equal(crossAssign.status, 400);

    const auditRow = raw.prepare("SELECT organization_id, action, target_id FROM security_audit_log WHERE action = 'task_created' ORDER BY id DESC LIMIT 1").get();
    assert.equal(auditRow.organization_id, 2);
    assert.equal(auditRow.target_id, String(created.id));
  });
});

test("task completion is limited to admin, creator, or assignee", async () => {
  await withD1(async (db, raw) => {
    const creatorCookie = await seedStaffSession(db, { email:"creator@example.com", role:"registrar", organizationId:1 });
    const assigneeCookie = await seedStaffSession(db, { email:"doctor@example.com", role:"radiologist", organizationId:1 });
    const strangerCookie = await seedStaffSession(db, { email:"other@example.com", role:"radiographer", organizationId:1 });

    const create = await callWorker(jsonRequest("/api/staff/tasks", {
      title:"Перевірити протокол",
      assignedEmail:"doctor@example.com",
    }, { headers:{ cookie:creatorCookie } }), db);
    const { id } = await create.json();

    const forbidden = await callWorker(jsonRequest("/api/staff/tasks", { id, status:"done" }, {
      method:"PATCH", headers:{ cookie:strangerCookie },
    }), db);
    assert.equal(forbidden.status, 403);

    const complete = await callWorker(jsonRequest("/api/staff/tasks", { id, status:"done" }, {
      method:"PATCH", headers:{ cookie:assigneeCookie },
    }), db);
    assert.equal(complete.status, 200);

    const row = raw.prepare("SELECT status, completed_by, organization_id FROM staff_tasks WHERE id = ?").get(id);
    assert.equal(row.status, "done");
    assert.equal(row.completed_by, "doctor@example.com");
    assert.equal(row.organization_id, 1);
  });
});
