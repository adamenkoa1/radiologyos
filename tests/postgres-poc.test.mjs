// PoC переходу на PostgreSQL: спільний інтерфейс доступу до БД (SqlDatabase)
// працює однаково на D1/SQLite і на Postgres-клієнті. Спайк ізольований —
// перевіряє лише сам адаптер, не чіпаючи наявні запити.

import assert from "node:assert/strict";
import test from "node:test";
import { d1Adapter, pgAdapter, toPgPlaceholders } from "../lib/db-adapter.ts";
import { withD1 } from "./helpers/d1.mjs";

test("d1Adapter drives the shared SqlDatabase interface on SQLite", async () => {
  await withD1(async (db) => {
    const sql = d1Adapter(db);
    const inserted = await sql.run("INSERT INTO app_settings (key,value) VALUES (?,?)", ["poc_key", "hello"]);
    assert.equal(inserted.changes, 1);
    const row = await sql.first("SELECT value FROM app_settings WHERE key = ?", ["poc_key"]);
    assert.equal(row.value, "hello");
    const rows = await sql.all("SELECT key FROM app_settings WHERE key = ?", ["poc_key"]);
    assert.equal(rows.length, 1);
    const missing = await sql.first("SELECT value FROM app_settings WHERE key = ?", ["nope"]);
    assert.equal(missing, null);
  });
});

test("toPgPlaceholders rewrites ? to $n positional params", () => {
  assert.equal(
    toPgPlaceholders("SELECT * FROM t WHERE a=? AND b=?"),
    "SELECT * FROM t WHERE a=$1 AND b=$2",
  );
});

test("pgAdapter maps rows and adds RETURNING id for inserts (no real DB)", async () => {
  const calls = [];
  const client = {
    query: async (sqlText, params) => {
      calls.push({ sqlText, params });
      if (/^\s*insert/i.test(sqlText)) return { rows: [{ id: 42 }], rowCount: 1 };
      return { rows: [{ value: "x" }], rowCount: 1 };
    },
  };
  const sql = pgAdapter(client);

  const first = await sql.first("SELECT value FROM t WHERE k=?", ["a"]);
  assert.equal(first.value, "x");
  assert.equal(calls[0].sqlText, "SELECT value FROM t WHERE k=$1");

  const inserted = await sql.run("INSERT INTO t (k) VALUES (?)", ["a"]);
  assert.equal(inserted.lastRowId, 42);
  assert.match(calls[1].sqlText, /RETURNING id$/);
});
