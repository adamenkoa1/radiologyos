import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Публічний статус заявки несе назву організації та людський підпис стану.
test("booking-status returns organization and a human status label", async () => {
  const route = await read("app/api/booking-status/route.ts");
  assert.match(route, /LEFT JOIN organizations o ON o\.id = b\.organization_id/);
  assert.match(route, /COALESCE\(o\.name, ''\) AS organization/);
  assert.match(route, /stateLabel\(result\.status\)/);
  assert.match(route, /statusLabel/);
});

// Список заявок пацієнта так само несе організацію й підпис стану.
test("my-bookings enriches each booking with organization and status label", async () => {
  const route = await read("app/api/my-bookings/route.ts");
  assert.match(route, /LEFT JOIN organizations o ON o\.id = b\.organization_id/);
  assert.match(route, /COALESCE\(o\.name, ''\) AS organization/);
  assert.match(route, /stateLabel\(String\(\(row as \{ status: string \}\)\.status\)\)/);
});

// Кабінет пацієнта коректно показує нові стани дослідження й організацію.
test("cabinet renders new study states, prefers server label and shows the organization", async () => {
  const cabinet = await read("public/site/cabinet.html");
  // Розширена мапа станів під єдину state machine.
  for (const s of ["in_progress", "protocol_ready", "issued", "queued"]) {
    assert.match(cabinet, new RegExp(`${s}:`), `statusMeta has ${s}`);
  }
  // Пріоритет — людський підпис із сервера; показуємо організацію.
  assert.match(cabinet, /b\.statusLabel \|\| meta\.label/);
  assert.match(cabinet, /b\.organization/);
});

// Кнопки «Копіювати» суми/призначення для переказу дають явний зворотний
// звʼязок і fallback — у webview, де clipboard API заблоковано, не мовчать.
test("cabinet copy buttons give feedback and fall back when the clipboard is blocked", async () => {
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /copyWithFeedback\(b,b\.dataset\.copyValue\|\|''\)/);
  assert.match(cabinet, /function copyWithFeedback\(btn,text\)/);
  assert.match(cabinet, /function fallbackCopy\(value,flash\)/);
  assert.match(cabinet, /document\.execCommand\('copy'\)/);
  assert.match(cabinet, /Скопійовано ✓/);
  // старий «мовчазний» виклик прибрано
  assert.doesNotMatch(cabinet, /navigator\.clipboard\?\.writeText\(b\.dataset\.copyValue/);
});
