#!/usr/bin/env node
// Check of the public site on phones and tablets (Playwright: iPhone and iPad — WebKit, the engine of Safari;
// Android — Chromium). Opens the pages like a visitor, takes screenshots, checks that nothing sticks out of the screen,
// that there are no script errors, and walks the booking form up to the messenger buttons (does NOT send anything).
// Runs weekly in GitHub Actions of the site repository in the Playwright image (edge/mobile-check.yml; results →
// branch mobile-check, read by C:\AI-Admin\agent\weekly-site-report.ps1) — not in the VM: browsers need more memory.
//   node mobile-check.mjs --site https://radiologyos.tech --out out
// Prints JSON: [{ device, page, ok, problems[], screenshot }] + the booking walk per device.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices, webkit } from 'playwright';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const SITE = arg('site', 'https://radiologyos.tech');
const OUT = arg('out', 'out');

export const DEVICES = [
  { id: 'iphone', label: 'iPhone 15 (Safari)', engine: webkit, profile: devices['iPhone 15'] },
  { id: 'android', label: 'Android, Pixel 7 (Chrome)', engine: chromium, profile: devices['Pixel 7'] },
  { id: 'ipad', label: 'iPad (Safari)', engine: webkit, profile: devices['iPad (gen 7)'] },
  { id: 'galaxy-small', label: 'Маленький Android, Galaxy S9+ (Chrome)', engine: chromium, profile: devices['Galaxy S9+'] }
];
export const PAGES = [
  { id: 'home', label: 'Головна', path: '/' },
  { id: 'price', label: 'Ціни', path: '/site/price.html' },
  { id: 'military', label: 'Військовим', path: '/site/military.html' }
];

// Elements wider than the screen (the page scrolls sideways) — the most common phone layout bug.
const OVERFLOW = () => {
  const w = document.documentElement.clientWidth;
  const out = [];
  if (document.documentElement.scrollWidth > w + 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > w + 1 && getComputedStyle(el).position !== 'fixed') {
        const name = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '');
        out.push(`${name} (+${Math.round(r.right - w)}px)`);
        if (out.length >= 3) break;
      }
    }
    if (!out.length) out.push(`ширина сторінки ${document.documentElement.scrollWidth}px > екран ${w}px`);
  }
  return out;
};

async function checkDevice(d) {
  const browser = await d.engine.launch();
  const context = await browser.newContext({ ...d.profile, locale: 'uk-UA', timezoneId: 'Europe/Kyiv' });
  const results = [];
  try {
    for (const p of PAGES) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 160)));
      // «Failed to load resource» carries no address — failed requests are taken from the responses instead.
      page.on('console', (m) => { if (m.type() === 'error' && !/favicon|stats\/|analytics|Failed to load resource/i.test(m.text())) errors.push(m.text().slice(0, 160)); });
      page.on('response', (r) => { if (r.status() >= 400 && !/\/stats\/|cloudflareinsights|favicon/.test(r.url())) errors.push(`запит ${r.url().replace(SITE, '')} → ${r.status()}`); });
      const problems = [];
      const t0 = Date.now();
      const res = await page.goto(SITE + p.path, { waitUntil: 'load', timeout: 45000 }).catch((e) => { problems.push('не відкрилась: ' + e.message.split('\n')[0]); return null; });
      const loadMs = Date.now() - t0;
      if (res && res.status() !== 200) problems.push(`HTTP ${res.status()}`);
      if (res) {
        await page.waitForTimeout(1500);
        for (const o of await page.evaluate(OVERFLOW)) problems.push('виходить за екран: ' + o);
        if (loadMs > 8000) problems.push(`повільно: ${Math.round(loadMs / 1000)} с`);
      }
      problems.push(...errors.map((e) => 'помилка скрипту: ' + e));
      const shot = path.join(OUT, `${d.id}-${p.id}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      results.push({ device: d.label, page: p.label, ok: problems.length === 0, loadMs, problems, screenshot: path.basename(shot) });
      await page.close();
    }
    // Booking walk on «Ціни»: choose the first study → «Моя заявка» → free hours → messenger buttons visible.
    const page = await context.newPage();
    const walk = { device: d.label, page: 'Запис (Ціни)', ok: false, problems: [], screenshot: `${d.id}-booking.png` };
    try {
      await page.goto(SITE + '/site/price.html', { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(1500);
      const add = page.locator('.row-add:visible').first();
      await add.scrollIntoViewIfNeeded({ timeout: 10000 });
      await add.click({ timeout: 10000 });
      await page.waitForTimeout(800);
      // The cart may open by itself after «Записатися»; otherwise — the «Моя заявка» button.
      if (!(await page.locator('.time-slots:visible').count())) {
        await page.locator('button:visible, a:visible').filter({ hasText: 'Моя заявка' }).first().click({ timeout: 10000 });
      }
      // Free hours come from the server — wait for them (or the «реєстратура» note) up to 10 s, as a patient would.
      await page.waitForFunction(() => [...document.querySelectorAll('.time-slots')].some((b) => b.offsetParent && b.querySelector('button.ts'))
        || [...document.querySelectorAll('.avail-note')].some((n) => n.offsetParent && /реєстратура/.test(n.textContent)), null, { timeout: 10000 }).catch(() => {});
      const times = await page.locator('.time-slots:visible button.ts').count();
      const free = await page.locator('.time-slots:visible button.ts:not([disabled])').count();
      const note = (await page.locator('.avail-note:visible').first().textContent({ timeout: 3000 }).catch(() => '')) || '';
      const book = page.locator('[data-book="whatsapp"]:visible').first();
      await book.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      const box = await book.boundingBox();
      const vw = page.viewportSize().width;
      if (!box) walk.problems.push('кнопку WhatsApp не видно');
      else if (box.x < 0 || box.x + box.width > vw + 1) walk.problems.push('кнопка WhatsApp виходить за екран');
      if (!times && !/реєстратура/.test(note)) walk.problems.push('немає годин і підказки');
      walk.hours = { shown: times, free };
      walk.ok = walk.problems.length === 0;
      await page.screenshot({ path: path.join(OUT, walk.screenshot) });
    } catch (e) {
      walk.problems.push('не вдалося пройти запис: ' + e.message.split('\n')[0]);
      await page.screenshot({ path: path.join(OUT, walk.screenshot) }).catch(() => {});
    }
    results.push(walk);
  } finally { await browser.close(); }
  return results;
}

await mkdir(OUT, { recursive: true });
const all = [];
for (const d of DEVICES) {
  try { all.push(...await checkDevice(d)); } catch (e) { all.push({ device: d.label, page: '—', ok: false, problems: ['браузер не запустився: ' + e.message.split('\n')[0]] }); }
}
await writeFile(path.join(OUT, 'result.json'), JSON.stringify(all, null, 2));
console.log(JSON.stringify(all));
