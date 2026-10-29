// Автозбереження чернетки протоколу: чисті правила рішень (debounce-гейт,
// відсутність зайвих збережень, заборона для signed/issued), серверний
// optimistic-lock конфлікт версій, і проводка редактора. Жодного паралельного
// API — фактичне збереження йде наявним PUT /api/staff/protocols.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  AUTOSAVE_DELAY_MS, shouldAutosave, remainsDirtyAfterSave, isVersionConflict, autosaveLabel,
} from "../lib/protocol-autosave.ts";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

// ── Чисті правила ────────────────────────────────────────────────────────────

test("debounce delay is ~1 second", () => {
  assert.equal(AUTOSAVE_DELAY_MS, 1000);
});

test("autosave runs only for an edited draft with real changes", () => {
  const base = { status:"draft", dirty:true, saving:false, conflict:false };
  assert.equal(shouldAutosave(base), true);
  // немає змін / первинне завантаження (dirty=false) → не зберігаємо
  assert.equal(shouldAutosave({ ...base, dirty:false }), false);
  // під час іншого збереження → не дублюємо
  assert.equal(shouldAutosave({ ...base, saving:true }), false);
  // невирішений конфлікт → не перезаписуємо
  assert.equal(shouldAutosave({ ...base, conflict:true }), false);
});

test("autosave is forbidden for signed and issued (and non-draft) statuses", () => {
  for (const status of ["signed", "issued", "ready", ""]) {
    assert.equal(shouldAutosave({ status, dirty:true, saving:false, conflict:false }), false, `${status} must not autosave`);
  }
});

test("stays dirty after save only when a newer edit arrived during the request", () => {
  assert.equal(remainsDirtyAfterSave(5, 5), false, "no new edit → clean, no redundant save");
  assert.equal(remainsDirtyAfterSave(5, 6), true, "edited during flight → keep dirty, reschedule");
});

test("version conflict is detected from HTTP 409", () => {
  assert.equal(isVersionConflict(409), true);
  assert.equal(isVersionConflict(200), false);
  assert.equal(isVersionConflict(400), false);
});

test("Ukrainian autosave labels follow the priority order", () => {
  assert.equal(autosaveLabel("saving", true), "Збереження…");
  assert.equal(autosaveLabel("conflict", true), "Конфлікт версій");
  assert.match(autosaveLabel("error", true), /Помилка збереження/);
  assert.equal(autosaveLabel("idle", true), "Є незбережені зміни");
  assert.equal(autosaveLabel("saved", false), "Збережено");
  assert.equal(autosaveLabel("idle", false), "");
});

// ── Серверний optimistic lock (той самий PUT, що й автозбереження) ───────────

async function addBooking(db, code, email) {
  const r = await db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, phone_normalized, service, service_code,
       equipment_id, desired_date, desired_time, assigned_radiologist_email, performed_at)
     VALUES (1, ?, 'Autosave Patient', '+380501119900', '380501119900', 'КТ органів грудної клітки', '408', 'ct',
       '2026-08-15', '10:00', ?, '2026-08-15T10:20:00')`
  ).bind(code, email).run();
  return Number(r.meta.last_row_id);
}
function draftPayload(bookingId, baseVersion, findings) {
  return {
    bookingId, baseVersion, templateKey:"generic", method:"КТ", sections:{},
    findings, conclusion:"", recommendations:"", number:"", status:"draft",
  };
}
const put = (db, cookie, payload) =>
  callWorker(jsonRequest("/api/staff/protocols", payload, { method:"PUT", headers:{ cookie } }), db);

test("draft autosave advances the version; a stale baseVersion is rejected (409), not silently overwritten", async () => {
  await withD1(async (db) => {
    const email = "autosave-doc@example.com";
    const cookie = await seedStaffSession(db, { email, role:"radiologist", displayName:"Autosave Doc" });
    const bookingId = await addBooking(db, "AS-001", email);

    // Перше автозбереження чернетки: version 0 → 1.
    const first = await put(db, cookie, draftPayload(bookingId, 0, "Перший текст."));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).version, 1, "version advances to 1");

    // Коректне наступне автозбереження бере baseVersion з відповіді (1) → 2.
    const second = await put(db, cookie, draftPayload(bookingId, 1, "Другий текст."));
    assert.equal(second.status, 200);
    assert.equal((await second.json()).version, 2);

    // Застарілий baseVersion (0) — конфлікт, сервер відхиляє, не перезаписує новіший текст.
    const stale = await put(db, cookie, draftPayload(bookingId, 0, "Застарілий перезапис."));
    assert.equal(stale.status, 409, "stale baseVersion is rejected");

    // Переконуємось, що новіший текст (version 2) не затерто застарілим запитом.
    const row = await db.prepare("SELECT findings, version FROM protocols WHERE booking_id = ? AND organization_id = 1").bind(bookingId).first();
    assert.equal(row.findings, "Другий текст.");
    assert.equal(Number(row.version), 2);
  });
});

// ── Проводка редактора ───────────────────────────────────────────────────────

test("editor wires debounced draft autosave through the existing PUT and reuses baseVersion", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  // дебаунс-ефект на ~1с, що кличе автозбереження чернетки
  assert.match(page, /setTimeout\(\(\) => \{ void save\("draft", \{ auto:true \}\); \}, AUTOSAVE_DELAY_MS\)/);
  assert.match(page, /shouldAutosave\(\{ status:doc\?\.status \?\? "", dirty, saving, conflict \}\)/);
  // явна кнопка лишається й не дублює запит (спільний in-flight guard)
  assert.match(page, /if \(saveInFlight\.current\) return;/);
  assert.match(page, /onClick=\{\(\)=>void save\("draft"\)\}/);
  // baseVersion далі йде з doc.version, оновлюється з відповіді сервера
  assert.match(page, /baseVersion:doc\.version \|\| 0/);
  assert.match(page, /version:data\.version \?\? current\.version/);
  // не губимо текст, уведений під час збереження
  assert.match(page, /setDirty\(remainsDirtyAfterSave\(seqAtSend, editSeq\.current\)\)/);
});

test("version conflict preserves typed text and shows an explicit recovery action", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /if \(isVersionConflict\(response\.status\)\) \{/);
  assert.match(page, /setConflict\(true\)/);
  assert.match(page, /className="protocolConflict"/);
  assert.match(page, /Копіювати мій текст/);
  assert.match(page, /Оновити серверну версію/);
  // конфлікт НЕ чіпає doc (текст лишається у формі) — одразу return після setConflict
  const conflictBlock = page.slice(page.indexOf("if (isVersionConflict(response.status))"), page.indexOf("if (!response.ok || !data.ok)"));
  assert.doesNotMatch(conflictBlock, /setDoc/);
});

test("editor never persists medical text to localStorage/sessionStorage", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
});

test("the autosave indicator exposes the Ukrainian states for a draft", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /className=\{`protocolAutosave \$\{autosaveState\}\$\{dirty \? " dirty":""\}`\}/);
  assert.match(page, /autosaveLabel\(autosaveState, dirty\)/);
});
