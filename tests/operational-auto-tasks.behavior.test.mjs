import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";
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
