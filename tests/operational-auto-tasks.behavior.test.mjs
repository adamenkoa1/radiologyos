import assert from "node:assert/strict";
import test from "node:test";
import { seedStaffSession, withD1 } from "./helpers/d1.mjs";
import { runOperationalTasks } from "../lib/operational-tasks.ts";

const NOW = Date.parse("2026-08-14T12:00:00Z");

test("operational automation is tenant-safe, idempotent and resolves stale tasks", async () => {
  await withD1(async (db,raw) => {
    raw.exec("INSERT OR IGNORE INTO organizations (id,name,slug,active) VALUES (2,'Org 2','org-2',1)");

    raw.exec(`INSERT INTO inventory_items (id,organization_id,sku,name,category,unit,min_stock,active)
      VALUES (101,1,'I-1','Контраст 350','contrast','фл',5,1),
             (201,2,'I-2','Катетер','catheter','шт',3,1)`);
    raw.exec(`INSERT INTO equipment_maintenance
      (id,organization_id,equipment_id,event_type,status,title,due_date,downtime_start,created_by)
      VALUES (301,1,'ct','maintenance','open','Планове ТО КТ','2026-08-10','','admin@example.com')`);

    const first=await runOperationalTasks(db,NOW);
    assert.equal(first.created,3);
    assert.equal(first.resolved,0);

    const open1=raw.prepare("SELECT organization_id,automation_key,status FROM staff_tasks WHERE source='automation' ORDER BY organization_id,automation_key").all();
    assert.equal(open1.length,3);
    assert.deepEqual(open1.map(r=>r.organization_id),[1,1,2]);
    assert.equal(new Set(open1.map(r=>`${r.organization_id}:${r.automation_key}`)).size,3);

    const second=await runOperationalTasks(db,NOW);
    assert.equal(second.created,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM staff_tasks WHERE source='automation'").get().n,3);

    raw.exec("INSERT INTO inventory_lots (id,organization_id,item_id,lot_number) VALUES (401,1,101,'LOT-1')");
    raw.exec("INSERT INTO inventory_movements (organization_id,item_id,lot_id,movement_type,quantity_delta,reason,actor_email) VALUES (1,101,401,'receipt',10,'Поповнення','admin@example.com')");
    raw.exec("UPDATE equipment_maintenance SET status='done',completed_by='admin@example.com',completed_at=CURRENT_TIMESTAMP WHERE id=301 AND organization_id=1");

    const resolved=await runOperationalTasks(db,NOW);
    assert.equal(resolved.resolved,2);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM staff_tasks WHERE organization_id=1 AND source='automation' AND status='open'").get().n,0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM staff_tasks WHERE organization_id=2 AND source='automation' AND status='open'").get().n,1);

    raw.exec("UPDATE staff_tasks SET status='done',completed_by='user@example.com',completed_at=CURRENT_TIMESTAMP WHERE organization_id=2 AND automation_key='inventory:low:201' AND status='open'");
    const reappeared=await runOperationalTasks(db,NOW);
    assert.equal(reappeared.created,1);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM staff_tasks WHERE organization_id=2 AND automation_key='inventory:low:201' AND status='open'").get().n,1);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM staff_tasks WHERE organization_id=2 AND automation_key='inventory:low:201'").get().n,2);
  });
});

test("automatic task audit never stores inventory or maintenance free-text details", async () => {
  await withD1(async (db,raw) => {
    raw.exec(`INSERT INTO inventory_items (id,organization_id,sku,name,category,unit,min_stock,active)
      VALUES (501,1,'SAFE','Секретна службова назва','other','шт',2,1)`);
    await runOperationalTasks(db,NOW);
    const audit=raw.prepare("SELECT details_json AS details FROM security_audit_log WHERE action='task_auto_created' ORDER BY id DESC LIMIT 1").get();
    assert.ok(audit);
    assert.match(audit.details,/inventory_item/);
    assert.doesNotMatch(audit.details,/Секретна службова назва/);
  });
});

test("clinical handoff tasks follow the study stage without duplicates or patient data leakage", async () => {
  await withD1(async (db,raw) => {
    await seedStaffSession(db,{email:"handoff-rad@example.com",role:"radiologist"});
    await seedStaffSession(db,{email:"handoff-tech-a@example.com",role:"radiographer"});
    await seedStaffSession(db,{email:"handoff-tech-b@example.com",role:"radiographer"});

    const inserted=await db.prepare(`INSERT INTO bookings
      (organization_id,code,name,phone,phone_normalized,service,service_code,equipment_id,
       desired_date,desired_time,status,assigned_radiologist_email,assigned_radiographer_email)
      VALUES (1,'HANDOFF-001','PATIENT-HANDOFF-SECRET','+380501112233','380501112233','КТ','408','ct',
        '2026-08-20','10:00','requested','handoff-rad@example.com','handoff-tech-a@example.com')`).run();
    const bookingId=Number(inserted.meta.last_row_id);

    const verification=await runOperationalTasks(db,NOW);
    assert.deepEqual(verification,{created:1,resolved:0});
    const verificationTask=raw.prepare(`SELECT id,automation_key AS automationKey,booking_id AS bookingId,
        assigned_email AS assignedEmail,title,details
      FROM staff_tasks WHERE organization_id=1 AND source='automation' AND status='open'`).get();
    assert.equal(verificationTask.automationKey,`booking:verification:${bookingId}`);
    assert.equal(verificationTask.bookingId,bookingId);
    assert.equal(verificationTask.assignedEmail,"");
    assert.doesNotMatch(`${verificationTask.title} ${verificationTask.details}`,/PATIENT-HANDOFF-SECRET/);

    const unchanged=await runOperationalTasks(db,NOW);
    assert.deepEqual(unchanged,{created:0,resolved:0});
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM staff_tasks WHERE source='automation'").get().n,1);

    raw.exec(`UPDATE bookings SET status='arrived' WHERE organization_id=1 AND id=${bookingId}`);
    const acquisition=await runOperationalTasks(db,NOW);
    assert.deepEqual(acquisition,{created:1,resolved:1});
    const acquisitionTask=raw.prepare(`SELECT id,automation_key AS automationKey,assigned_email AS assignedEmail,due_date AS dueDate
      FROM staff_tasks WHERE organization_id=1 AND source='automation' AND status='open'`).get();
    assert.equal(acquisitionTask.automationKey,`booking:acquisition:${bookingId}`);
    assert.equal(acquisitionTask.assignedEmail,"handoff-tech-a@example.com");

    raw.exec(`UPDATE bookings SET assigned_radiographer_email='handoff-tech-b@example.com',desired_date='2026-08-21'
      WHERE organization_id=1 AND id=${bookingId}`);
    const refreshed=await runOperationalTasks(db,NOW);
    assert.deepEqual(refreshed,{created:0,resolved:0});
    const refreshedTask=raw.prepare(`SELECT id,assigned_email AS assignedEmail,due_date AS dueDate
      FROM staff_tasks WHERE organization_id=1 AND automation_key='booking:acquisition:${bookingId}' AND status='open'`).get();
    assert.equal(refreshedTask.id,acquisitionTask.id,"same open task is refreshed instead of duplicated");
    assert.equal(refreshedTask.assignedEmail,"handoff-tech-b@example.com");
    assert.equal(refreshedTask.dueDate,"2026-08-21");

    raw.exec(`UPDATE bookings SET status='reporting' WHERE organization_id=1 AND id=${bookingId}`);
    const reporting=await runOperationalTasks(db,NOW);
    assert.deepEqual(reporting,{created:1,resolved:1});
    const reportingTask=raw.prepare(`SELECT automation_key AS automationKey,assigned_email AS assignedEmail,priority
      FROM staff_tasks WHERE organization_id=1 AND source='automation' AND status='open'`).get();
    assert.equal(reportingTask.automationKey,`booking:reporting:${bookingId}`);
    assert.equal(reportingTask.assignedEmail,"handoff-rad@example.com");
    assert.equal(reportingTask.priority,"high");

    raw.exec(`UPDATE bookings SET status='protocol_ready' WHERE organization_id=1 AND id=${bookingId}`);
    const issuance=await runOperationalTasks(db,NOW);
    assert.deepEqual(issuance,{created:1,resolved:1});
    const issuanceTask=raw.prepare(`SELECT automation_key AS automationKey,assigned_email AS assignedEmail
      FROM staff_tasks WHERE organization_id=1 AND source='automation' AND status='open'`).get();
    assert.equal(issuanceTask.automationKey,`booking:issuance:${bookingId}`);
    assert.equal(issuanceTask.assignedEmail,"");

    raw.exec(`UPDATE bookings SET status='issued' WHERE organization_id=1 AND id=${bookingId}`);
    const issued=await runOperationalTasks(db,NOW);
    assert.deepEqual(issued,{created:0,resolved:1});
    assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM staff_tasks
      WHERE organization_id=1 AND source='automation' AND source_entity_type='booking' AND status='open'`).get().n,0);

    const allBookingTasks=raw.prepare(`SELECT title,details FROM staff_tasks
      WHERE organization_id=1 AND source='automation' AND source_entity_type='booking'`).all();
    assert.equal(allBookingTasks.length,4);
    assert.doesNotMatch(JSON.stringify(allBookingTasks),/PATIENT-HANDOFF-SECRET/);
    const audit=raw.prepare(`SELECT details_json AS details FROM security_audit_log
      WHERE organization_id=1 AND action IN ('task_auto_created','task_auto_resolved') AND details_json LIKE '%booking%'`).all();
    assert.ok(audit.length>=4);
    assert.doesNotMatch(JSON.stringify(audit),/PATIENT-HANDOFF-SECRET/);
  });
});
