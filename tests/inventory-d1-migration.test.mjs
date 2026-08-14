import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("inventory migration avoids trigger bodies that Wrangler splits as incomplete input", async () => {
  const migration = await read("drizzle/0037_inventory_stock.sql");
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `inventory_movements`/);
});

test("inventory write-off uses one conditional insert and checks whether a row was inserted", async () => {
  const route = await read("app/api/staff/inventory/route.ts");
  assert.match(route, /INSERT INTO inventory_movements[\s\S]*SELECT \?,\?,\?,'writeoff'/);
  assert.match(route, /SELECT SUM\(quantity_delta\)[\s\S]*organization_id = \? AND lot_id = \?/);
  assert.match(route, /result\.meta\.changes/);
  assert.match(route, /Недостатній залишок у цій партії/);
});
