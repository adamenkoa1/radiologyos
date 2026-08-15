import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addBooking(db, { code, doctor = "", radiographer = "", time = "10:00" }) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, service, service_code,
       equipment_id, desired_date, desired_time, assigned_radiologist_email, assigned_radiographer_email)
     VALUES (1, ?, ?, '+380501112233', '380501112233', 'КТ', '408', 'ct',
       '2026-08-20', ?, ?, ?)`
  ).bind(code, `Patient ${code}`, time, doctor, radiographer).run();
  return Number(result.meta.last_row_id);
}

async function createTask(db, cookie, body) {
  return callWorker(jsonRequest("/api/staff/tasks", body, { headers:{ cookie } }), db);
}

async function listTasks(db, cookie) {
  const response = await callWorker(new Request("http://localhost/api/staff/tasks", { headers:{ cookie } }), db);
  assert.equal(response.status, 200);
  return response.json();
}

test("booking-linked tasks follow current booking access while department tasks remain shared", async () => {
  await withD1(async (db) => {
    const admin = await seedStaffSession(db, { email:"task-admin@example.com", role:"admin" });
    const doctorA = await seedStaffSession(db, { email:"task-a@example.com", role:"radiologist" });
    const doctorB = await seedStaffSession(db, { email:"task-b@example.com", role:"radiologist" });
    const techA = await seedStaffSession(db, { email:"task-tech@example.com", role:"radiographer" });

    const bookingA = await addBooking(db, { code:"TASK-A-001", doctor:"task-a@example.com", radiographer:"task-tech@example.com", time:"10:00" });
    const bookingB = await addBooking(db, { code:"TASK-B-001", doctor:"task-b@example.com", time:"13:00" });

    const general = await createTask(db, admin, { title:"Перевірити запас контрасту" });
    assert.equal(general.status, 201);
    const generalId = (await general.json()).id;

    const linkedB = await createTask(db, admin, {
      title:"Уточнити клінічний висновок пацієнта B",
      details:"PATIENT-B-SECRET",
      bookingId:bookingB,
      assignedEmail:"task-b@example.com",
    });
    assert.equal(linkedB.status, 201);
    const linkedBId = (await linkedB.json()).id;

    const aList = await listTasks(db, doctorA);
    assert.equal(aList.tasks.some((task) => task.id === generalId), true, "department task remains shared");
    assert.equal(aList.tasks.some((task) => task.id === linkedBId), false, "foreign patient task must be hidden");
    assert.doesNotMatch(JSON.stringify(aList), /PATIENT-B-SECRET/);

    const bList = await listTasks(db, doctorB);
    assert.equal(bList.tasks.some((task) => task.id === generalId), true);
    assert.equal(bList.tasks.some((task) => task.id === linkedBId), true);

    const techList = await listTasks(db, techA);
    assert.equal(techList.tasks.some((task) => task.id === linkedBId), false);

    const foreignCreate = await createTask(db, doctorA, {
      title:"Спроба прив'язати чуже дослідження",
      bookingId:bookingB,
      assignedEmail:"task-a@example.com",
    });
    assert.equal(foreignCreate.status, 404);

    const badAssignee = await createTask(db, admin, {
      title:"Неправильний виконавець",
      bookingId:bookingA,
      assignedEmail:"task-b@example.com",
    });
    assert.equal(badAssignee.status, 400);
    assert.match(JSON.stringify(await badAssignee.json()), /не має доступу/i);

    const linkedA = await createTask(db, admin, {
      title:"Завдання пацієнта A",
      details:"PATIENT-A-SECRET",
      bookingId:bookingA,
      assignedEmail:"task-a@example.com",
    });
    assert.equal(linkedA.status, 201);
    const linkedAId = (await linkedA.json()).id;

    const techAList = await listTasks(db, techA);
    assert.equal(techAList.tasks.some((task) => task.id === linkedAId), true,
      "assigned radiographer may see a booking-linked task for the same study");

    await db.prepare(
      "UPDATE bookings SET assigned_radiologist_email = 'task-b@example.com' WHERE organization_id = 1 AND id = ?"
    ).bind(bookingA).run();

    const aAfterReassign = await listTasks(db, doctorA);
    assert.equal(aAfterReassign.tasks.some((task) => task.id === linkedAId), false,
      "revoked booking access must revoke task visibility too");
    assert.doesNotMatch(JSON.stringify(aAfterReassign), /PATIENT-A-SECRET/);

    const stalePatch = await callWorker(jsonRequest("/api/staff/tasks", { id:linkedAId, status:"done" }, {
      method:"PATCH", headers:{ cookie:doctorA },
    }), db);
    assert.equal(stalePatch.status, 404, "former creator/assignee cannot mutate after booking access is revoked");

    const bAfterReassign = await listTasks(db, doctorB);
    assert.equal(bAfterReassign.tasks.some((task) => task.id === linkedAId), true,
      "new booking assignee receives patient-linked task visibility");
  });
});

test("D1 rejects cross-tenant booking references on staff tasks", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'task-org-two', 'Task Org Two', 1)").run();
    const foreignBooking = await db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized, service, service_code,
         equipment_id, desired_date, desired_time)
       VALUES (2, 'TASK-ORG2-001', 'Foreign Patient', '+380509999999', '380509999999',
         'КТ', '408', 'ct', '2026-08-21', '15:00')`
    ).run();
    const foreignBookingId = Number(foreignBooking.meta.last_row_id);

    await assert.rejects(
      db.prepare(
        `INSERT INTO staff_tasks
          (organization_id, title, details, booking_id, created_by)
         VALUES (1, 'Cross tenant', 'SECRET', ?, 'admin@example.com')`
      ).bind(foreignBookingId).run(),
      /staff task booking tenant mismatch/i,
    );

    const localTask = await db.prepare(
      `INSERT INTO staff_tasks (organization_id, title, details, created_by)
       VALUES (1, 'Department task', '', 'admin@example.com')`
    ).run();
    await assert.rejects(
      db.prepare("UPDATE staff_tasks SET booking_id = ? WHERE organization_id = 1 AND id = ?")
        .bind(foreignBookingId, Number(localTask.meta.last_row_id)).run(),
      /staff task booking tenant mismatch/i,
    );
  });
});
