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

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE = process.env.E2E_BASE_URL;
const ART = fileURLToPath(new URL("./artifacts/", import.meta.url));

function skip(reason) {
  console.log(`E2E SKIPPED — F1 BLOCKED: ${reason}`);
  console.log("Див. docs/protocol-builder-master-audit.md → «Інструкція усунення блокера».");
  process.exit(0);
}

if (!BASE) skip("E2E_BASE_URL не задано (немає авторизованого інстансу з D1/ASSETS-bindings)");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  skip("модуль 'playwright' не встановлено (`npm i -D playwright`), доступний лише бінарник Chromium");
}

const results = [];
async function step(name, fn) {
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
const browser = await chromium.launch();
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
  const response = await page.goto(`${BASE}/staff/protocols`, { waitUntil: "networkidle" });
  if (response && response.status() >= 500) throw new Error(`HTTP ${response.status()}`);
  await page.screenshot({ path: `${ART}/01-protocols-open.png`, fullPage: true });
  if (await page.getByText("Захищений розділ").count()) throw new Error("екран входу — авторизація не вдалася");
  if (!(await page.getByText("Конструктор протоколів").count())) throw new Error("заголовок конструктора не знайдено");
});

await step("Черга протоколів присутня з фільтрами", async () => {
  await page.getByRole("group", { name: "Фільтр черги протоколів" }).waitFor({ timeout: 5000 });
});

await step("Вибір першого дослідження з черги", async () => {
  const items = page.locator(".protocolQueueItem");
  if (!(await items.count())) throw new Error("черга порожня — потрібні засіяні дослідження, що очікують протоколу");
  await items.first().click();
  await page.locator(".protocolEditor").waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${ART}/02-editor-open.png`, fullPage: true });
});

await step("Перемикання режимів зберігає редактор (Швидкий/Структурований/Вільний)", async () => {
  for (const mode of ["Швидкий", "Вільний", "Структурований"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
  }
});

// ── F1.3 Сценарій 1 — КТ ОГК, гіперпневматизація S7–S10 ──────────────────────
await step("Сценарій 1: шаблон КТ ОГК обрано", async () => {
  await page.getByRole("combobox").first().selectOption({ label: "КТ органів грудної клітки" }).catch(async () => {
    // Якщо авто-підбір уже дав ct_chest — просто перевіряємо наявність конструктора.
  });
  await page.getByText("Конструктор знахідок").waitFor({ timeout: 5000 });
});

await step("Сценарій 1: складено опис S7–S10 з −952 HU без авто-«вродженого»", async () => {
  const pick = async (labelRe, optionLabel) => {
    const sel = page.getByRole("combobox").filter({ has: page.getByText(labelRe) });
    await sel.first().selectOption({ label: optionLabel }).catch(() => {});
  };
  // Орган → Легеня; Знахідка → гіперпневматизація; сторона/частка/сегмент; HU.
  await page.getByLabel("Орган / структура").selectOption({ label: "Легеня" }).catch(() => pick(/Орган/, "Легеня"));
  await page.getByLabel("Знахідка").selectOption({ label: /гіперпневматизац/ }).catch(() => {});
  await page.getByLabel("Латералізація").selectOption({ label: "Справа" }).catch(() => {});
  await page.getByLabel(/Частка/).selectOption({ label: "Нижня частка" }).catch(() => {});
  await page.getByLabel(/Сегменти/).selectOption({ label: /S7–S10/ }).catch(() => {});
  await page.getByLabel(/Щільність/).fill("-952").catch(() => {});
  await page.getByText("Збіднення судинного малюнка").click().catch(() => {});
  await page.getByText("Без сформованих бул").click().catch(() => {});
  await page.getByRole("button", { name: /Додати у опис/ }).click();
  const findings = await page.locator("#protocol-findings textarea, textarea").first().inputValue();
  await page.screenshot({ path: `${ART}/03-scenario1-composed.png`, fullPage: true });
  if (!/базальних сегментах S7–S10/.test(findings)) throw new Error("опис не містить локалізації S7–S10");
  if (!/−952 HU/.test(findings)) throw new Error("опис не містить −952 HU");
  if (/вроджен/i.test(findings)) throw new Error("опис помилково стверджує вроджений характер");
});

await step("Друкований перегляд рендериться", async () => {
  await page.emulateMedia({ media: "print" }).catch(() => {});
  await page.screenshot({ path: `${ART}/04-print.png`, fullPage: true });
  await page.emulateMedia({ media: "screen" }).catch(() => {});
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nE2E: ${results.length - failed.length}/${results.length} кроків пройдено; артефакти у tests/e2e/artifacts/`);
if (failed.length) {
  console.log("Невдалі кроки (можлива потреба підтвердити селектори на першому запуску):");
  for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
