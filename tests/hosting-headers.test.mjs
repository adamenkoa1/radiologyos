import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("build emits a no-cache rule for the public /site so updates show at once", async () => {
  // dist/client/_headers збирається білдом (див. scripts/build-verified.sh).
  const headers = await read("dist/client/_headers");
  // Хешовані ассети — вічний immutable-кеш.
  assert.match(headers, /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
  // Публічний сайт без кеш-хешів — revalidate, щоб деплой було видно одразу.
  assert.match(headers, /\/site\/\*\s+Cache-Control: no-cache/);
});

test("build script appends the /site rule after vinext build", async () => {
  const script = await read("scripts/build-verified.sh");
  assert.match(script, /dist\/client\/_headers/);
  assert.match(script, /\/site\/\*\\n\s+Cache-Control: no-cache/);
});

test("military mobile: bottom padding clears the fixed action bar", async () => {
  const html = await read("public/site/military.html");
  // Вужчий брейк не має скидати нижній відступ під фіксованою панеллю (86px).
  assert.doesNotMatch(html, /body\{padding:0 12px 12px/);
  assert.match(html, /body\{padding:0 12px 86px/);
});

test("public booking pages share one stylesheet (dedup, no per-page copies)", async () => {
  const shared = await read("public/site/assets/site.css");
  // Спільний файл містить витягнуті booking-правила (слот-пікер тощо).
  assert.match(shared, /\.slot-picker/);
  assert.match(shared, /\.sp-day/);
  // Три booking-сторінки підключають його; логіни-кабінет — ні (немає кошика).
  for (const p of ["index", "price", "military"]) {
    const html = await read(`public/site/${p}.html`);
    assert.match(html, /<link rel="stylesheet" href="\/site\/assets\/site\.css">/, `${p} має підключати site.css`);
    // Витягнуті правила більше не дублюються в inline <style>.
    assert.doesNotMatch(html, /\.sp-day\.on\{/, `${p}: .sp-day.on лишилось в inline`);
  }
});
