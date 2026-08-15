import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("legacy inventory migration remains unchanged and trigger-free", async () => {
  const migration = await read("drizzle/0037_inventory_stock.sql");
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `inventory_movements`/);
});

test("new inventory write-off is document-posted and D1 prevents negative stock atomically", async () => {
  const route = await read("app/api/staff/inventory/route.ts");
  const engine = await read("lib/inventory-documents.ts");
  const hardening = await read("drizzle/0062_inventory_document_integrity_hardening.sql");

  // Compatibility callers no longer write the register directly; they create and post a registrar.
  assert.match(route, /createInventoryDocument/);
  assert.match(route, /postInventoryDocument/);
  assert.doesNotMatch(route, /INSERT INTO inventory_movements[\s\S]*SELECT \?,\?,\?,'writeoff'/);

  // Application-level precheck gives a friendly 409 in the normal path.
  assert.match(engine, /SELECT COALESCE\(SUM\(quantity_delta\),0\) AS stock/);
  assert.match(engine, /Недостатній залишок у партії для проведення документа/);

  // D1 is the final authority and closes concurrent write-off races.
  assert.match(hardening, /CREATE TRIGGER IF NOT EXISTS `inventory_writeoff_nonnegative_stock`/);
  assert.match(hardening, /RAISE\(ABORT,'inventory_negative_stock'\)/);
  assert.match(hardening, /CREATE TRIGGER IF NOT EXISTS `inventory_movements_no_update`/);
  assert.match(hardening, /CREATE TRIGGER IF NOT EXISTS `inventory_movements_no_delete`/);
});