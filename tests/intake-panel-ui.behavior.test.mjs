// Видима черга вхідних заявок на /staff/protocols (MP, блок D): реєстратор
// бачить заявки, бере в роботу, створює дослідження (авто-звʼязок) і надсилає
// чесне підтвердження. Перевірка через інспекцію джерела сторінки + стилів.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("intake panel is gated to admin/registrar and only shows when there are open requests", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /\{canCreateStudy && intakeRequests\.length > 0 && <div className="intakePanel">/);
});

test("the panel loads open requests from the staff endpoint (new + in_progress, 403 → empty)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  const fn = page.slice(page.indexOf("async function loadIntakeRequests"), page.indexOf("async function patchIntake"));
  assert.match(fn, /fetch\("\/api\/staff\/intake-requests\?status=new"/);
  assert.match(fn, /res\.status === 403\) setIntakeRequests\(\[\]\)/);
  assert.match(fn, /r\.status === "new" \|\| r\.status === "in_progress"/);
  // завантаження при монтуванні
  assert.match(page, /void loadIntakeRequests\(\);/);
});

test("intake actions patch the endpoint with claim / decline / link / confirm", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /patchIntake\(id, \{ action:"claim" \}\)/);
  assert.match(page, /patchIntake\(id, \{ action:"decline" \}\)/);
  assert.match(page, /patchIntake\(id, \{ action:"confirm", text:confirmText \}\)/);
  const patch = page.slice(page.indexOf("async function patchIntake"), page.indexOf("async function claimIntake"));
  assert.match(patch, /fetch\("\/api\/staff\/intake-requests", \{ method:"PATCH"/);
});

test("creating a study from an intake request claims it and auto-links on save (converted)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  const start = page.slice(page.indexOf("function startStudyFromIntake"), page.indexOf("async function createWalkInStudy"));
  assert.match(start, /setPendingIntakeId\(req\.id\)/);
  assert.match(start, /setNewStudyOpen\(true\)/);
  assert.match(start, /void claimIntake\(req\.id\)/);
  // walk-in success auto-links the pending intake request
  const create = page.slice(page.indexOf("async function createWalkInStudy"), page.indexOf("async function openBooking"));
  assert.match(create, /if \(pendingIntakeId\) \{/);
  assert.match(create, /patchIntake\(pendingIntakeId, \{ action:"link", bookingId:data\.bookingId, patientId:nsPatientId \}\)/);
});

test("confirmation is honest: only sent:true reports success, otherwise shows the error", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  const fn = page.slice(page.indexOf("async function sendIntakeConfirmation"), page.indexOf("function startStudyFromIntake"));
  assert.match(fn, /if \(r\.sent\)/);
  assert.match(fn, /перевірте токен бота/);
});

test("the confirm composer warns against clinical content in the messenger", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /confirmFor===r\.id && <div className="intakeConfirm">/);
  assert.match(page, /maxLength=\{600\}/);
  // плейсхолдер застерігає: без діагнозу/результатів/зображень
  assert.match(page, /intakeConfirm[\s\S]{0,400}(діагноз|результат|зображ)/i);
});

test("intake panel styles exist in workspace CSS and dark theme (no dead CSS)", async () => {
  const css = await read("app/styles/02-workspace.css");
  for (const cls of ["intakePanel", "intakePanelHead", "intakeList", "intakeMsg", "intakeActions", "intakeConfirm"]) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `${cls} styled in workspace CSS`);
  }
  const dark = await read("app/styles/08-dark-theme.css");
  assert.match(dark, /\.intakePanel\b/);
});
