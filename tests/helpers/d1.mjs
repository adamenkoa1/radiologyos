// Поведінковий harness: справжня in-memory SQLite (node:sqlite) під інтерфейсом
// D1, на яку спираються маршрути. Дає змогу перевіряти РЕАЛЬНУ поведінку —
// SQL-фільтри, RBAC, збереження даних — а не наявність рядків у коді.
//
// Маршрути читають біндинг через globalThis.__RADIOLOGY_DB__ (див. lib/db.ts),
// тож ми підставляємо адаптер туди на час тесту.

import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { statSync, readdirSync } from "node:fs";
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
      db.exec("BEGIN;");
      try {
        for (const s of statements) out.push(await s.run());
        db.exec("COMMIT;");
        return out;
      } catch (error) {
        try { db.exec("ROLLBACK;"); } catch {}
        throw error;
      }
    },
    async exec(sql) { db.exec(sql); return { count: 0, duration: 0 }; },
    _raw: db,
  };
}

export async function applyMigrations(db, { beforeMigration } = {}) {
  const files = (await readdir(fileURLToPath(DRIZZLE_DIR)))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (beforeMigration) await beforeMigration({ db, file });
    const sql = await readFile(new URL(file, DRIZZLE_DIR), "utf8");
    try {
      if (file === "0093_study_correction_registrar.sql") {
        db.exec("BEGIN;");
        try {
          db.exec(sql);
          db.exec("COMMIT;");
        } catch (migrationError) {
          try { db.exec("ROLLBACK;"); } catch {}
          throw migrationError;
        }
      } else {
        db.exec(sql);
      }
    } catch (e) {
      throw new Error(`Міграція ${file} не застосувалась: ${e.message}`);
    }
  }
}

export async function freshDb(options = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  await applyMigrations(raw, options);
  const db = wrapAsD1(raw);
  return { db, raw, close: () => raw.close() };
}

export async function withD1(fn, options = {}) {
  const { db, raw, close } = await freshDb(options);
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

// Поведінкові тести імпортують ЗІБРАНИЙ воркер (dist/server/index.js), а не .ts.
// Якщо запустити `node --test` на застарілому dist, отримаємо привидні падіння,
// що не мають стосунку до змін. Тому перед завантаженням воркера перевіряємо
// свіжість збірки: dist має існувати й бути новішим за джерела. `npm test`
// збирає перед запуском, тож у нормальному потоці ця перевірка мовчазна.
const WORKER_DIST = new URL("../../dist/server/index.js", import.meta.url);
const SOURCE_DIRS = ["app", "lib", "worker", "db"];
const SOURCE_EXT = new Set([".ts", ".tsx", ".css", ".html", ".js", ".mjs"]);
// Джерела читаються перед записом dist, тож можуть бути на частки секунди
// «новішими» через гранулярність mtime — допуск прибирає хибні спрацювання.
const FRESHNESS_TOLERANCE_MS = 2000;
const IGNORED_DIRS = new Set(["node_modules", "dist", ".next", ".git", ".wrangler"]);

function newestSourceMtime() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  let newest = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        const dot = entry.name.lastIndexOf(".");
        if (dot < 0 || !SOURCE_EXT.has(entry.name.slice(dot))) continue;
        const m = statSync(full).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  for (const d of SOURCE_DIRS) walk(`${root}${d}`);
  return newest;
}

let freshnessChecked = false;
function assertFreshDist() {
  if (freshnessChecked) return;
  freshnessChecked = true;
  const distPath = fileURLToPath(WORKER_DIST);
  let distMtime;
  try {
    distMtime = statSync(distPath).mtimeMs;
  } catch {
    throw new Error(
      "dist/server/index.js не знайдено. Поведінкові тести імпортують зібраний " +
      "воркер — спершу запустіть `npm run build` (або `npm test`, який збирає сам).",
    );
  }
  const newest = newestSourceMtime();
  if (newest > distMtime + FRESHNESS_TOLERANCE_MS) {
    throw new Error(
      "dist застарілий: джерела новіші за dist/server/index.js. Поведінкові тести " +
      "виконують саме зібраний воркер, тож без свіжого білду падіння будуть привидні. " +
      "Запустіть `npm run build` (або `npm test`, який збирає перед тестами).",
    );
  }
}

let workerPromise = null;
function loadWorker() {
  if (!workerPromise) {
    assertFreshDist();
    workerPromise = import(WORKER_DIST.href).then((m) => m.default);
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

export async function seedPatientSession(
  db,
  phoneNormalized,
  organizationId = 1,
  identity = null,
  patientId = "",
) {
  let scope = identity;
  if (!scope) {
    const booking = await db.prepare(
      `SELECT date_of_birth AS dob, code
       FROM bookings
       WHERE organization_id = ? AND phone_normalized = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`
    ).bind(organizationId, phoneNormalized).first();
    if (!booking) throw new Error("seedPatientSession requires a matching booking or explicit identity scope");
    scope = booking.dob
      ? { kind: "dob", value: String(booking.dob) }
      : { kind: "booking", value: String(booking.code) };
  }
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  await db.prepare(
    `INSERT INTO patient_sessions
      (token_hash, phone_normalized, organization_id, identity_kind, identity_value, patient_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+30 minutes'))`
  ).bind(tokenHash, phoneNormalized, organizationId, scope.kind, scope.value, patientId).run();
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
