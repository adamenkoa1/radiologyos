import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("RadiologyOS v2 design tokens: single source of truth is declared", async () => {
  const css = await read("app/globals.css");
  // Типографіка (48/36/28/22/18/16/14/12).
  for (const [tok, val] of [["--fs-display", "48px"], ["--fs-h1", "36px"], ["--fs-h2", "28px"],
    ["--fs-h3", "22px"], ["--fs-lg", "18px"], ["--fs-base", "16px"], ["--fs-sm", "14px"], ["--fs-xs", "12px"]]) {
    assert.match(css, new RegExp(`${tok}:\\s*${val}`), `type token ${tok}`);
  }
  // 8pt-простір, радіуси, тіні.
  assert.match(css, /--sp-2:\s*8px/);
  assert.match(css, /--r-md:\s*12px/);
  assert.match(css, /--sh-2:/);
  // Рух — лише дві тривалості.
  assert.match(css, /--dur-fast:\s*150ms/);
  assert.match(css, /--dur-base:\s*250ms/);
  // Кольори модальностей — єдине джерело.
  for (const tok of ["--mod-ct", "--mod-xray", "--mod-fluoro", "--mod-us", "--mod-contrast", "--mod-urgent"]) {
    assert.match(css, new RegExp(`${tok}:`), `modality token ${tok}`);
  }
});

test("modality colours reference tokens (no duplicated hex across surfaces)", async () => {
  const css = await read("app/globals.css");
  // Пульт, календар використовують змінні модальностей, а не хардкод.
  assert.match(css, /\.dashCard\.mod-ct\{border-left:4px solid var\(--mod-ct\)\}/);
  assert.match(css, /\.dashAgendaRow\.mod-ct\{box-shadow:inset 3px 0 0 0 var\(--mod-ct\)\}/);
  assert.match(css, /\.apptCardRow\.mod-ct\{border-left-color:var\(--mod-ct\)\}/);
  // Рух прив'язаний до токенів на ключових інтерактивних елементах.
  assert.match(css, /\.dashMcItem\{[^}]*transition:var\(--dur-fast\) var\(--ease\)\}/);
});

test("card system: .ds-card primitives + dashboard surfaces use token radius/elevation", async () => {
  const css = await read("app/globals.css");
  // Примітив картки й рівні елевації.
  assert.match(css, /\.ds-card\{[^}]*border-radius:var\(--r-lg\)[^}]*box-shadow:var\(--sh-1\)/);
  assert.match(css, /\.ds-card\.raised\{box-shadow:var\(--sh-2\)\}/);
  assert.match(css, /\.ds-card\.flat\{box-shadow:none\}/);
  // Ієрархія на Пульті: нові заявки — Primary (підняті), аналітика — пласкіша.
  assert.match(css, /\.dashPending\{[^}]*border-radius:var\(--r-lg\)[^}]*box-shadow:var\(--sh-2\)/);
  assert.match(css, /\.dashLoad\{[^}]*box-shadow:var\(--sh-1\)/);
  // Радіуси уніфіковано на токен (без розкиду 12/14/18).
  assert.doesNotMatch(css, /\.dashList\{[^}]*border-radius:18px/);
});

test("typography: headings bound to the token scale", async () => {
  const css = await read("app/globals.css");
  // Заголовок сторінки масштабується до --fs-h1 (більша присутність на 27\").
  assert.match(css, /\.workspacePageHead h1\{[^}]*font-size:clamp\(24px,2\.4vw,var\(--fs-h1\)\)/);
  // Опис і хлібні крихти — на токенах.
  assert.match(css, /\.workspaceBreadcrumb\{[^}]*font-size:var\(--fs-xs\)!important/);
  assert.match(css, /p:last-child\{[^}]*font-size:var\(--fs-sm\)/);
  // Заголовки секцій Пульта — єдиний розмір із шкали.
  assert.match(css, /\.dashPendingHead h2\{[^}]*font-size:var\(--fs-lg\)/);
  assert.match(css, /\.dashCalendarHead h2\{[^}]*font-size:var\(--fs-lg\)/);
  // Утиліти заголовків для подальшого впровадження.
  assert.match(css, /\.ds-h2\{[^}]*font-size:var\(--fs-h2\)/);
});

test("staff chrome identity: brand vars drive sidebar/logo/topbar", async () => {
  const css = await read("app/globals.css");
  // Брендові змінні хрому визначені на shell.
  assert.match(css, /--ws-brand:#123d3a;--ws-brand-deep:#0d302e;--ws-accent:#ef744d/);
  // Сайдбар — брендовий градієнт (глибина).
  assert.match(css, /\.workspaceSidebar\{[^}]*background:linear-gradient\(180deg,var\(--ws-brand\),var\(--ws-brand-deep\)\)/);
  // Лого-мітка з акцентною крапкою.
  assert.match(css, /\.workspaceBrandMark::after\{[^}]*background:var\(--ws-accent\)/);
  // Топбар — брендова стрічка-підпис зверху.
  assert.match(css, /\.workspaceTopbar::before\{[^}]*background:linear-gradient\(90deg,var\(--ws-brand\),var\(--ws-accent\)\)/);
  // Активний пункт навігації — акцент зі змінної.
  assert.match(css, /\.workspaceNavigation a\.active:before\{[^}]*background:var\(--ws-accent\)/);
});

test("public site radii are unified on the design-system token scale", async () => {
  // Радіус-токени тепер живуть у спільному site.css (дедуплікація).
  const shared = await read("public/site/assets/site.css");
  assert.match(shared, /--r-lg:16px/, "site.css: нема радіус-токенів");
  for (const page of ["index", "price", "military", "cabinet"]) {
    const html = await read(`public/site/${page}.html`);
    // Радіуси зведені на var(--r-*) — жодного сирого border-radius:Npx.
    assert.doesNotMatch(html, /border-radius:\d+px/, `${page}: лишились сирі px-радіуси`);
  }
});
