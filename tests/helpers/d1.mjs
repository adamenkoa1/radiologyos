// Поведінковий harness: справжня in-memory SQLite (node:sqlite) під інтерфейсом
// D1, на яку спираються маршрути. Дає змогу перевіряти РЕАЛЬНУ поведінку —
// SQL-фільтри, RBAC, збереження даних — а не наявність рядків у коді.
//
// Маршрути читають біндинг через globalThis.__RADIOLOGY_DB__ (див. lib/db.ts),
// тож ми підставляємо адаптер туди на час тесту.

import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

function normArg(a) {
  if (a === undefined || a === null) return null;
  if (typeof a === "boolean") return a ? 1 : 0;
  if (typeof a === "bigint") return Number(a);
  return a;
}

function wrapAsD1(db) {
  const makeStmt = (sql) => {
    const prepared = db.prepare(sql);
    let bound = [];
    const api = {
      bind(...args) { bound = args.map(normArg); return api; },
      async first(column) {
        const row = prepared.get(...bound);
        if (row == null) return null;
        return column ? (row[column] ?? null) : row;
      },
      async all() {
        return { results: prepared.all(...bound), success: true, meta: {} };
      },
      async run() {
        const r = prepared.run(...bound);
        return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid), duration: 0 } };
      },
      async raw() {
        const rows = prepared.all(...bound);
        return rows.map((row) => Object.values(row));
      },
    };
    return api;
  };
  return {
    prepare(sql) { return makeStmt(sql); },
    async batch(statements) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
    async exec(sql) { db.exec(sql); return { count: 0, duration: 0 }; },
    _raw: db,
  };
}

export async function applyMigrations(db) {
  const files = (await readdir(fileURLToPath(DRIZZLE_DIR)))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, DRIZZLE_DIR), "utf8");
    try {
      db.exec(sql);
    } catch (e) {
      throw new Error(`Міграція ${file} не застосувалась: ${e.message}`);
    }
  }
}

export async function freshDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  await applyMigrations(raw);
  const db = wrapAsD1(raw);
  return { db, raw, close: () => raw.close() };
}

export async function withD1(fn) {
  const { db, raw, close } = await freshDb();
  const key = "__RADIOLOGY_DB__";
  const previous = globalThis[key];
  globalThis[key] = db;
  try {
    return await fn(db, raw);
  } finally {
    if (previous === undefined) delete globalThis[key];
    else globalThis[key] = previous;
    close();
  }
}

export function jsonRequest(url, body, { method = "POST", headers = {}, ip = "203.0.113.7" } = {}) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let workerPromise = null;
function loadWorker() {
  if (!workerPromise) {
    const url = new URL("../../dist/server/index.js", import.meta.url);
    workerPromise = import(url.href).then((m) => m.default);
  }
  return workerPromise;
}

export async function seedStaffSession(db, {
  email,
  role,
  displayName = "",
  organizationId = 1,
  withMembership = true,
}) {
  await db.prepare(
    `INSERT INTO staff_members (email, display_name, role, active) VALUES (?, ?, ?, 1)
     ON CONFLICT(email) DO UPDATE SET role = excluded.role, active = 1`
  ).bind(email, displayName || email, role).run();
  if (withMembership) {
    await db.prepare(
      `INSERT INTO memberships (organization_id, member_email, role, active)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(organization_id, member_email)
       DO UPDATE SET role = excluded.role, active = 1`
    ).bind(organizationId, email, role).run();
  }
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  await db.prepare(
    `INSERT INTO staff_sessions (token_hash, email, expires_at)
     VALUES (?, ?, datetime('now', '+1 hour'))`
  ).bind(tokenHash, email).run();
  return `rid_session=${rawToken}`;
}

export async function seedPatientSession(db, phoneNormalized, organizationId = 1) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  await db.prepare(
    `INSERT INTO patient_sessions (token_hash, phone_normalized, organization_id, expires_at)
     VALUES (?, ?, ?, datetime('now', '+30 minutes'))`
  ).bind(tokenHash, phoneNormalized, organizationId).run();
  return `rid_patient=${rawToken}`;
}

export async function callWorker(request, db, envOverrides = {}) {
  const worker = await loadWorker();
  const env = {
    DB: db,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    ...envOverrides,
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  return worker.fetch(request, env, ctx);
}
