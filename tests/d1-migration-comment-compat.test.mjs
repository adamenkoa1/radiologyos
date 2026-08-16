import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = new URL("../drizzle/0059_business_inventory_documents.sql", import.meta.url);

test("migration 0059 keeps only statement-breakpoint line comments", async () => {
  const sql = await readFile(migration, "utf8");
  const otherComments = sql
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("--") && line !== "--> statement-breakpoint");

  assert.deepEqual(otherComments, []);
});
