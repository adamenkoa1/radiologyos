import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

test("behavioral D1 batch commits all successful statements in order",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("CREATE TABLE batch_atomicity_probe (id INTEGER PRIMARY KEY,value TEXT NOT NULL)");
    const results=await db.batch([
      db.prepare("INSERT INTO batch_atomicity_probe (id,value) VALUES (1,'first')"),
      db.prepare("INSERT INTO batch_atomicity_probe (id,value) VALUES (2,'second')"),
    ]);
    assert.equal(results.length,2);
    const rows=raw.prepare("SELECT id,value FROM batch_atomicity_probe ORDER BY id").all();
    assert.deepEqual(rows.map(row=>({id:Number(row.id),value:String(row.value)})),[
      {id:1,value:"first"},{id:2,value:"second"},
    ]);
  });
});

test("behavioral D1 batch rolls back the whole sequence when any statement fails",async()=>{
  await withD1(async(db,raw)=>{
    raw.exec("CREATE TABLE batch_atomicity_probe (id INTEGER PRIMARY KEY,value TEXT NOT NULL)");
    await assert.rejects(db.batch([
      db.prepare("INSERT INTO batch_atomicity_probe (id,value) VALUES (1,'must-roll-back')"),
      db.prepare("INSERT INTO batch_atomicity_probe (id,value) VALUES (1,'duplicate')"),
      db.prepare("INSERT INTO batch_atomicity_probe (id,value) VALUES (2,'must-not-run')"),
    ]),/UNIQUE constraint failed|constraint/i);
    assert.deepEqual(raw.prepare("SELECT id,value FROM batch_atomicity_probe ORDER BY id").all(),[]);
  });
});
