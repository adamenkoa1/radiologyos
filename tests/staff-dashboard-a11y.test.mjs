// /staff/dashboard (Пульт відділення) — найщільніший інтерактивом staff-екран.
// Сторінка вже зріла (catch-резилієнс у всіх мутаціях, екрани доступу/мережі з
// «Повторити», фонове автооновлення з паузою, Kyiv-TZ, role="group"+aria-pressed
// на чипах-фільтрах, aria-label на панелі показників і tel-кнопках, toast
// role="status"). Залишкові прогалини:
//  • жоден інтерактивний контрол (KPI-лінки, чипи, дії карток, рядки агенди,
//    кнопки прибуття/неявки, лінки аналітики) не мав видимого focus-ring (WCAG 2.4.7);
//  • плейсхолдер завантаження не оголошувався (role="status").

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("dashboard interactive controls have a visible keyboard focus ring", async () => {
  const css = await read("app/styles/13-dashboard-monitor.css");
  for (const sel of [
    "dashMcItem", "dashChip", "dashCardBtn", "dashAgendaMain", "dashMark", "dashStat",
  ]) {
    assert.match(css, new RegExp(`\\.workspaceShell \\.${sel}:focus-visible`), `${sel} focus-visible`);
  }
  assert.match(css, /:focus-visible,[\s\S]*?\{\s*outline: 2px solid var\(--ws-accent\);\s*outline-offset: 2px;\s*\}/);
});

test("dashboard loading placeholder is announced as a status", async () => {
  const page = await read("app/staff/dashboard/page.tsx");
  assert.match(page, /<p className="dashLoading" role="status" aria-live="polite">Завантаження зведення…<\/p>/);
});

test("dashboard keeps its existing filter/nav a11y (regression guard)", async () => {
  const page = await read("app/staff/dashboard/page.tsx");
  assert.match(page, /className="dashChips" role="group" aria-label="Фільтр розкладу"/);
  assert.match(page, /aria-pressed=\{agendaFilter===f\.id\}/);
  assert.match(page, /className="dashMc" aria-label="Головні показники дня"/);
});
