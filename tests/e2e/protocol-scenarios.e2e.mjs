// Авторизований браузерний E2E-раннер для /staff/protocols (MASTER PROMPT 3,
// F1). САМОСТІЙНИЙ скрипт (не node:test, не входить у `npm test`) — запускається
// лише `npm run test:e2e`. Чесно пропускається (exit 0) без середовища, щоб
// ніколи не видавати фальшивого проходження й не ламати CI.
//
// Потрібне середовище (див. docs/protocol-builder-master-audit.md):
//   E2E_BASE_URL        — URL авторизованого staging/local інстансу з bindings
//   E2E_STAFF_COOKIE    — значення Cookie з валідною staff-сесією (варіант A), АБО
//   E2E_STAFF_EMAIL + E2E_STAFF_PASSWORD — логін через /staff/login (варіант B)
//   (НЕ production, НЕ реальні дані пацієнтів)
//
// Селектори спираються на реальні українські рядки з app/staff/protocols/
// page.tsx; на першому авторизованому запуску їх слід підтвердити (деталі — в
// журналі аудиту).

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const BASE = process.env.E2E_BASE_URL;
const startedAt = new Date().toISOString();
const ART = fileURLToPath(new URL(`./artifacts/${startedAt.replaceAll(":", "-")}/`, import.meta.url));

function skip(reason) {
  console.log(`E2E SKIPPED — F1 BLOCKED: ${reason}`);
  console.log("Див. docs/protocol-builder-master-audit.md → «Інструкція усунення блокера».");
  process.exit(0);
}

if (!BASE) skip("E2E_BASE_URL не задано (немає авторизованого інстансу з D1/ASSETS-bindings)");
const baseUrl = new URL(BASE);
if (!["http:", "https:"].includes(baseUrl.protocol) || /^(www\.)?radiologyos\.tech$/i.test(baseUrl.hostname)) {
  throw new Error("E2E дозволено лише на локальному або staging інстансі, не production");
}
if (!process.env.E2E_STAFF_COOKIE && !(process.env.E2E_STAFF_EMAIL && process.env.E2E_STAFF_PASSWORD)) {
  skip("не задано синтетичну staff-сесію або тестовий логін");
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  try {
    // Managed runtimes can provide Playwright through Node's module search path.
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    skip("модуль 'playwright' недоступний; потрібен драйвер і сумісний Chromium");
  }
}

const results = [];
let skippedSteps = 0;
async function step(name, fn) {
  if (results.some((result) => result.ok === false)) {
    skippedSteps++;
    console.log(`SKIPPED — ${name}: попередній крок не пройдено`);
    return;
  }
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   — ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error && error.message || error) });
    console.log(`FAIL — ${name}: ${error && error.message || error}`);
  }
}

await mkdir(ART, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.E2E_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({ locale: "uk-UA", viewport: { width: 1440, height: 900 } });

// ── Авторизація ──────────────────────────────────────────────────────────────
if (process.env.E2E_STAFF_COOKIE) {
  const url = new URL(BASE);
  await context.addCookies(process.env.E2E_STAFF_COOKIE.split(";").map((pair) => {
    const idx = pair.indexOf("=");
    return { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim(), domain: url.hostname, path: "/" };
  }));
}
const page = await context.newPage();
page.setDefaultTimeout(10000);

if (!process.env.E2E_STAFF_COOKIE && process.env.E2E_STAFF_EMAIL) {
  await step("Логін через /staff/login", async () => {
    await page.goto(`${BASE}/staff/login?returnTo=%2Fstaff%2Fprotocols`, { waitUntil: "networkidle" });
    await page.getByLabel(/пошт|email|логін/i).first().fill(process.env.E2E_STAFF_EMAIL);
    await page.getByLabel(/парол/i).first().fill(process.env.E2E_STAFF_PASSWORD || "");
    await page.getByRole("button", { name: /увійти|вхід/i }).first().click();
    await page.waitForLoadState("networkidle");
  });
}

// ── F1.2 UI-чек-ліст ─────────────────────────────────────────────────────────
await step("Відкриття конструктора протоколів (не 500, не екран входу)", async () => {
  const id = process.env.E2E_BOOKING_ID;
  if (id && !/^[1-9]\d*$/.test(id)) throw new Error("Некоректний E2E_BOOKING_ID");
  const response = await page.goto(`${BASE}/staff/protocols${id ? `?studyId=${id}` : ""}`, { waitUntil: "domcontentloaded" });
  if (!response || response.status() !== 200) throw new Error(`HTTP ${response?.status()}`);
  await page.getByRole("group", { name: "Фільтр черги протоколів" }).waitFor();
  await page.screenshot({ path: `${ART}/01-protocols-open.png` });
  if (await page.getByText("Захищений розділ").count()) throw new Error("екран входу — авторизація не вдалася");
  if (!(await page.getByText("Конструктор протоколів").count())) throw new Error("заголовок конструктора не знайдено");
});

await step("Черга протоколів присутня з фільтрами", async () => {
  await page.getByRole("group", { name: "Фільтр черги протоколів" }).waitFor({ timeout: 5000 });
});

await step("Вибір синтетичного дослідження", async () => {
  const items = page.locator(".protocolQueueItem");
  if (!process.env.E2E_BOOKING_ID) {
    const synthetic = items.filter({ hasText: /SYNTHETIC|TEST PILOT/ });
    await synthetic.first().waitFor();
    await synthetic.first().click();
  }
  await page.locator(".protocolEditor").waitFor({ timeout: 5000 });
  await page.locator("#protocol-findings textarea").waitFor();
  if (!/SYNTHETIC|TEST PILOT/.test(await page.locator(".protocolEditor").innerText())) {
    throw new Error("Потрібна явно позначена синтетична заявка; реальні записи не змінюються");
  }
  await page.screenshot({ path: `${ART}/02-editor-open.png` });
});

await step("Перемикання режимів зберігає редактор (Швидкий/Структурований/Вільний)", async () => {
  const findings = page.locator("#protocol-findings textarea");
  const conclusion = page.locator("#protocol-conclusion textarea");
  const manualDescription = "SYNTHETIC ручний опис F1.";
  const manualConclusion = "SYNTHETIC ручний висновок F1.";
  await findings.fill(manualDescription);
  await conclusion.fill(manualConclusion);
  for (const mode of ["Швидкий", "Вільний", "Структурований"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    if (await findings.inputValue() !== manualDescription || await conclusion.inputValue() !== manualConclusion) {
      throw new Error("перемикання режиму втратило ручні правки");
    }
  }
});

// ── F1.3 Сценарій 1 — КТ ОГК, гіперпневматизація S7–S10 ──────────────────────
await step("Сценарій 1: шаблон КТ ОГК обрано", async () => {
  await page.getByLabel(/^Шаблон протоколу/).selectOption("ct_chest");
  await page.locator(".findingComposer").waitFor({ timeout: 5000 });
});

await step("Сценарій 1: складено опис S7–S10 з −952 HU без авто-«вродженого»", async () => {
  // Орган → Легеня; Знахідка → гіперпневматизація; сторона/частка/сегмент; HU.
  const original = await page.locator("#protocol-findings textarea").inputValue();
  const originalConclusion = await page.locator("#protocol-conclusion textarea").inputValue();
  const controls = page.locator(".findingComposerControls").first();
  await controls.getByLabel(/^Орган \/ структура/).selectOption("lung");
  await controls.getByLabel(/^Знахідка/).selectOption("hyperpneumatization");
  await controls.getByLabel(/^Латералізація/).selectOption("right");
  await controls.getByLabel(/^Частка \(необов’язково\)/).selectOption("lower");
  await controls.getByLabel(/^Сегменти \(необов’язково\)/).selectOption("basal");
  await controls.getByRole("textbox", { name: "Щільність (HU)", exact: true }).fill("-952");
  await page.getByRole("checkbox", { name: "Збіднення судинного малюнка", exact: true }).check();
  await page.getByRole("checkbox", { name: "Без сформованих бул", exact: true }).check();
  await page.getByRole("button", { name: /Додати у опис/ }).click();
  const findings = await page.locator("#protocol-findings textarea").inputValue();
  if (original && !findings.startsWith(original)) throw new Error("вставлення втратило ручний текст");
  const conclusion = await page.locator("#protocol-conclusion textarea").inputValue();
  if (!conclusion.startsWith(originalConclusion) || !/КТ-ознаки.*S7–S10/.test(conclusion)) throw new Error("висновок не узгоджений або втрачено ручні правки");
  await page.screenshot({ path: `${ART}/03-scenario1-composed.png` });
  if (!/базальних сегментах S7–S10/.test(findings)) throw new Error("опис не містить локалізації S7–S10");
  if (!/−952 HU/.test(findings)) throw new Error("опис не містить −952 HU");
  if (/вроджен/i.test(findings)) throw new Error("опис помилково стверджує вроджений характер");
  if (!/правої легені/.test(findings) || !/без сформованих бул/.test(findings)) throw new Error("втрачено параметри знахідки");
});

await step("Збереження та повторне відкриття не втрачають знахідку", async () => {
  const findings = await page.locator("#protocol-findings textarea").inputValue();
  const conclusion = await page.locator("#protocol-conclusion textarea").inputValue();
  const pending = page.waitForResponse((response) => response.url().endsWith("/api/staff/protocols")
    && response.request().method() === "PUT" && response.request().postDataJSON().findings === findings);
  await page.getByRole("button", { name: "Зберегти чернетку", exact: true }).click();
  const response = await pending;
  if (response.status() !== 200) throw new Error(`збереження повернуло HTTP ${response.status()}`);
  const bookingId = response.request().postDataJSON().bookingId;
  const storedResponse = await context.request.get(`${BASE}/api/staff/protocols?bookingId=${bookingId}`);
  if (storedResponse.status() !== 200) throw new Error("збережений протокол недоступний");
  const stored = (await storedResponse.json()).protocol;
  if (stored?.findings !== findings || stored?.conclusion !== conclusion || !stored?.findingsStructured?.length) {
    throw new Error("D1 не зберегла текст або структуровані знахідки");
  }
  await page.goto(`${BASE}/staff/protocols?studyId=${bookingId}`, { waitUntil: "domcontentloaded" });
  await page.locator("#protocol-findings textarea").waitFor();
  if (await page.locator("#protocol-findings textarea").inputValue() !== findings
    || await page.locator("#protocol-conclusion textarea").inputValue() !== conclusion) {
    throw new Error("повторне відкриття змінило збережений текст");
  }
});

await step("Друкований перегляд рендериться", async () => {
  await page.emulateMedia({ media: "print" });
  await page.locator(".protocolPrint").waitFor();
  if (await page.locator(".workspaceBusinessBar").isVisible()
    || await page.locator(".protocolEditor > .protocolFilterTabs").isVisible()) {
    throw new Error("друк містить робочу навігацію або перемикач режиму");
  }
  const text = await page.locator(".protocolPrint").innerText();
  if (!/базальних сегментах S7–S10/.test(text) || !/−952 HU/.test(text)) throw new Error("друк не містить складеної знахідки");
  await page.screenshot({ path: `${ART}/04-print.png` });
  await page.emulateMedia({ media: "screen" });
});

await browser.close();

const failed = results.filter((r) => !r.ok);
await writeFile(`${ART}/results.json`, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), results, skippedSteps }, null, 2));
console.log(`\nE2E: ${results.length - failed.length}/${results.length} кроків пройдено; артефакти у ${ART}`);
console.log(`Пропущено залежних кроків: ${skippedSteps}`);
if (failed.length) {
  console.log("Невдалі кроки (можлива потреба підтвердити селектори на першому запуску):");
  for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
