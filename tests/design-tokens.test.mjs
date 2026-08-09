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
