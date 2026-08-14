import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("equipment maintenance migration is tenant scoped and indexes operational queries",async()=>{
  const sql=await read("drizzle/0038_equipment_maintenance.sql");
  const db=new DatabaseSync(":memory:");
  for(const s of sql.split(/-->\s*statement-breakpoint/).map(x=>x.trim()).filter(Boolean))db.exec(s);
  db.prepare("INSERT INTO equipment_maintenance (organization_id,equipment_id,event_type,title,created_by) VALUES (?,?,?,?,?)").run(1,"ct","fault","Tube fault","a@x");
  db.prepare("INSERT INTO equipment_maintenance (organization_id,equipment_id,event_type,title,created_by) VALUES (?,?,?,?,?)").run(2,"ct","maintenance","PM","b@x");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM equipment_maintenance WHERE organization_id=1").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM equipment_maintenance WHERE organization_id=2").get().n,1);
  assert.match(sql,/equipment_maintenance_org_equipment_idx/);
  assert.match(sql,/equipment_maintenance_org_status_idx/);
});

test("maintenance API derives tenant from membership and guards every record operation",async()=>{
  const route=await read("app/api/staff/maintenance/route.ts");
  assert.match(route,/requireOrgContext\(request,db\)/);
  assert.match(route,/MANAGER_ROLES = new Set\(\["admin","radiographer"\]\)/);
  assert.match(route,/WHERE organization_id=\?/);
  assert.match(route,/equipmentExists\(db,ctx\.organizationId,equipmentId\)/);
  assert.match(route,/activeMember\(db,ctx\.organizationId,assignedEmail\)/);
  assert.match(route,/equipment_maintenance_created/);
  assert.match(route,/equipment_maintenance_completed/);
  assert.doesNotMatch(route,/CREATE TABLE|ALTER TABLE|DROP TABLE/);
});

test("maintenance workspace exposes faults, service, downtime and is reachable from equipment",async()=>{
  const [page,equipment,globals,css]=await Promise.all([
    read("app/staff/maintenance/page.tsx"),read("app/staff/equipment/page.tsx"),read("app/globals.css"),read("app/styles/19-maintenance.css")
  ]);
  assert.match(page,/ТО та несправності/);
  assert.match(page,/Несправність/);
  assert.match(page,/Початок простою/);
  assert.match(page,/Сервісна організація/);
  assert.match(page,/active="equipment"/);
  assert.match(equipment,/href="\/staff\/maintenance"/);
  assert.match(globals,/19-maintenance\.css/);
  assert.match(css,/maintenanceKpis/);
});
