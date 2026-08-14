import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("custom field schema enforces tenant-safe definitions and values",async()=>{
  await withD1(async(db)=>{
    await db.prepare("INSERT INTO organizations (id,slug,name,active) VALUES (2,'other','Other',1)").run();
    const one=await db.prepare(`INSERT INTO custom_field_definitions
      (organization_id,label,field_type,created_by) VALUES (1,'A','text','admin@one')`).run();
    const two=await db.prepare(`INSERT INTO custom_field_definitions
      (organization_id,label,field_type,created_by) VALUES (2,'B','text','admin@two')`).run();
    const oneId=Number(one.meta.last_row_id),twoId=Number(two.meta.last_row_id);

    await db.prepare(`INSERT INTO custom_field_values
      (organization_id,definition_id,entity_type,entity_id,value_text,updated_by)
      VALUES (1,?,'booking',101,'one','admin@one')`).bind(oneId).run();
    await db.prepare(`INSERT INTO custom_field_values
      (organization_id,definition_id,entity_type,entity_id,value_text,updated_by)
      VALUES (2,?,'booking',202,'two','admin@two')`).bind(twoId).run();

    const own=await db.prepare("SELECT value_text AS value FROM custom_field_values WHERE organization_id=? AND entity_id=?")
      .bind(1,101).all();
    assert.deepEqual(own.results,[{value:"one"}]);

    await assert.rejects(
      db.prepare(`INSERT INTO custom_field_values
        (organization_id,definition_id,entity_type,entity_id,value_text,updated_by)
        VALUES (1,?,'booking',303,'cross','admin@one')`).bind(twoId).run(),
      /FOREIGN KEY/i,
    );
  });
});

test("study custom field API is tenant, assignment and role scoped",async()=>{
  const api=await read("app/api/staff/custom-fields/route.ts");
  assert.match(api,/requireOrgContext/);
  assert.match(api,/canAccessBooking\(db,ctx\.member,bookingId,ctx\.organizationId\)/);
  assert.match(api,/ctx\.member\.role!=="admin"/);
  assert.match(api,/WHERE organization_id=\? AND id=\? AND entity_type='booking'/);
  assert.match(api,/custom_field_value_updated/);
  assert.match(api,/details:\{fieldId,cleared:normalized\.remove\}/);
  assert.doesNotMatch(api,/details:\{[^}]*value/i);
  assert.doesNotMatch(api,/CREATE TABLE|ALTER TABLE/);
});

test("study drawer and admin screen expose custom fields without changing core booking schema",async()=>{
  const drawer=await read("app/staff/studies/study-context-drawer.tsx");
  const page=await read("app/staff/custom-fields/page.tsx");
  const migration=await read("drizzle/0042_study_custom_fields.sql");
  assert.match(drawer,/Додаткові реквізити/);
  assert.match(drawer,/\/api\/staff\/custom-fields\?bookingId=/);
  assert.match(drawer,/method:"PUT"/);
  assert.match(page,/Нове поле дослідження/);
  assert.match(page,/active="settings"/);
  assert.match(migration,/custom_field_definitions/);
  assert.match(migration,/custom_field_values/);
  assert.doesNotMatch(migration,/ALTER TABLE bookings/);
});
