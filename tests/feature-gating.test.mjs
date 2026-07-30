import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Модуль DICOM/PACS гейтиться сервером за feature flag профілю організації.
test("imaging API is gated by the dicom_pacs feature flag", async () => {
  const route = await read("app/api/staff/imaging/route.ts");
  assert.match(route, /pacsModuleEnabled/);
  assert.match(route, /getOrgProfile\(db, ctx\)/);
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /profile\.flags\.dicom_pacs/);
  assert.match(route, /Модуль DICOM \/ PACS вимкнено/);
  // Гейт застосовано і на читання (GET), і на прив'язку (PUT).
  const guards = route.match(/pacsModuleEnabled\(request, db\)/g) || [];
  assert.ok(guards.length >= 2, "both GET and PUT are gated");
});

// Бічна панель ховає підпункти вимкнених можливостей (конструктор).
test("workspace sidebar hides sublinks for disabled features", async () => {
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /function childVisible\(/);
  assert.match(shell, /flag:"dicom_pacs"/);
  assert.match(shell, /flag:"patient_cabinet"/);
  assert.match(shell, /flag:"reminders"/);
  assert.match(shell, /\.filter\(childVisible\)/);
  // Прапорці тягнуться з профілю організації.
  assert.match(shell, /\/api\/staff\/org-profile/);
  // До завантаження прапорців нічого не ховаємо (без блимання).
  assert.match(shell, /if \(!flags\) return true/);
});
