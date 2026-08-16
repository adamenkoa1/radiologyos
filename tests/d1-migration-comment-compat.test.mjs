import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = new URL("../drizzle/0059_business_inventory_documents.sql", import.meta.url);

function triggerBody(sql, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(
    new RegExp(`CREATE TRIGGER IF NOT EXISTS \\`${escaped}\\`[\\s\\S]*?\\nBEGIN\\n([\\s\\S]*?)\\nEND;\\n--> statement-breakpoint`),
  );
  assert.ok(match, `trigger ${name} must exist and keep its statement breakpoint`);
  return match[1];
}

test("migration 0059 keeps only statement-breakpoint line comments", async () => {
  const sql = await readFile(migration, "utf8");
  const otherComments = sql
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("--") && line !== "--> statement-breakpoint");

  assert.deepEqual(otherComments, []);
});

test("migration 0059 keeps parser-sensitive inventory guards single-statement", async () => {
  const sql = await readFile(migration, "utf8");
  const tenantGuard = triggerBody(sql, "inventory_document_lines_tenant_insert");
  const movementGuard = triggerBody(sql, "inventory_movement_document_integrity");

  assert.equal((tenantGuard.match(/;/g) ?? []).length, 1);
  assert.equal((movementGuard.match(/;/g) ?? []).length, 1);

  const tenantErrors = [
    "inventory_document_tenant_mismatch",
    "inventory_item_tenant_mismatch",
    "inventory_lot_tenant_mismatch",
    "inventory_booking_tenant_mismatch",
  ];
  for (const error of tenantErrors) assert.match(tenantGuard, new RegExp(error));
  for (let i = 1; i < tenantErrors.length; i += 1) {
    assert.ok(tenantGuard.indexOf(tenantErrors[i - 1]) < tenantGuard.indexOf(tenantErrors[i]));
  }

  assert.match(movementGuard, /inventory_document_link_incomplete/);
  assert.match(movementGuard, /inventory_document_link_invalid/);
  assert.ok(
    movementGuard.indexOf("inventory_document_link_incomplete") <
      movementGuard.indexOf("inventory_document_link_invalid"),
  );
});
