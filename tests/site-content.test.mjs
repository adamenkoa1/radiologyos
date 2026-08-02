import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SITE_CONTENT_DEFAULTS,
  parseSiteContent,
  sanitizeSiteContent,
} from "../lib/site-content.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("sanitizeSiteContent clamps text, coerces published and keeps defaults", () => {
  const out = sanitizeSiteContent({ brandTitle: "  Нова назва  ", published: 0, unknown: "x" });
  assert.equal(out.brandTitle, "Нова назва"); // trimmed
  assert.equal(out.published, false); // coerced from falsy
  assert.equal(out.brandSubtitle, SITE_CONTENT_DEFAULTS.brandSubtitle); // missing → default
  assert.ok(!("unknown" in out)); // unknown fields dropped
  const long = sanitizeSiteContent({ brandTitle: "x".repeat(500) });
  assert.ok(long.brandTitle.length <= 120); // max length enforced
});

test("published defaults to true when unset", () => {
  assert.equal(sanitizeSiteContent({}).published, true);
});

test("legacy branding migrates to the exact current slogan and no logo", () => {
  const migrated = sanitizeSiteContent({
    slogan: "Точна діагностика. Вчасна допомога. Підтримка військових.",
    logoUrl: "/hospital-emblem.jpg",
  });
  assert.equal(migrated.slogan, "Точна діагностика-вчасна допомога. Досвід, якому можна довіряти.");
  assert.equal(migrated.logoUrl, "");
});

test("legacy clinic copy migrates to precise emergency-hours positioning", () => {
  const migrated = sanitizeSiteContent({
    workHours: "Пн–Сб · 08:00–17:00",
    about: "Відділення променевої діагностики працює цілодобово та об’єднує кабінет комп’ютерної томографії й рентгенологічні кабінети лікувального корпусу. Обладнання регулярно проходить технічне обслуговування, а у 2025 році вдосконалено проведення КТ із контрастуванням.",
  });
  assert.match(migrated.workHours, /08:30–17:30/);
  assert.match(migrated.workHours, /Екстрені дослідження/i);
  assert.match(migrated.workHours, /цілодобово/);
  assert.match(migrated.about, /Екстрені дослідження/);
});

test("previous approved slogan and hours migrate to the current wording", () => {
  const migrated = sanitizeSiteContent({
    slogan: "Точна діагностика-вчасна допомога.",
    workHours: "Екстрені дослідження для військовослужбовців — цілодобово · цивільним — за попереднім записом",
  });
  assert.equal(migrated.slogan, SITE_CONTENT_DEFAULTS.slogan);
  assert.equal(migrated.workHours, SITE_CONTENT_DEFAULTS.workHours);
  assert.match(migrated.workHours, /24\/7/);
});

test("an old empty slogan migrates to the approved wording", () => {
  assert.equal(
    sanitizeSiteContent({ slogan: "" }).slogan,
    SITE_CONTENT_DEFAULTS.slogan,
  );
});

test("previous broad 24/7 copy migrates without changing custom text", () => {
  const migrated = sanitizeSiteContent({
    workHours: "Військовослужбовцям — 24/7 · цивільним — за попереднім записом",
    about: "Відділення променевої діагностики працює для військовослужбовців цілодобово — 24/7. Цивільні пацієнти можуть пройти платні дослідження за попереднім записом.",
  });
  assert.equal(migrated.workHours, SITE_CONTENT_DEFAULTS.workHours);
  assert.equal(migrated.about, SITE_CONTENT_DEFAULTS.about);
  assert.equal(sanitizeSiteContent({ workHours: "Мій режим" }).workHours, "Мій режим");
});

test("parseSiteContent returns defaults for empty or invalid JSON", () => {
  assert.deepEqual(parseSiteContent(""), SITE_CONTENT_DEFAULTS);
  assert.deepEqual(parseSiteContent("{bad json"), SITE_CONTENT_DEFAULTS);
  assert.equal(parseSiteContent(JSON.stringify({ phone: "+380 44 000" })).phone, "+380 44 000");
});

test("admin site route is admin-only and persists to app_settings", async () => {
  const route = await read("app/api/staff/site/route.ts");
  assert.match(route, /member\.role !== "admin"/);
  assert.match(route, /setSetting\(db, SITE_CONTENT_KEY/);
  assert.match(route, /sanitizeSiteContent\(body\.content\)/);
});

test("public site-content endpoint returns merged content with short caching", async () => {
  const route = await read("app/api/site-content/route.ts");
  assert.match(route, /parseSiteContent\(/);
  assert.match(route, /max-age=60/); // коротке кешування замість no-store
  // Worker робить виняток, щоб не перезаписати кеш на no-store.
  const worker = await read("worker/index.ts");
  assert.match(worker, /pathname === "\/api\/site-content"/);
});

test("site content editor is a visual storefront with dedicated tariff navigation", async () => {
  const legacy = await read("app/staff/site/page.tsx");
  const page = await read("app/staff/structure/page.tsx");
  assert.match(legacy, /redirect\("\/staff\/structure"\)/);
  assert.match(page, /\/api\/staff\/structure/);
  assert.match(page, /active="structure"/);
  assert.match(page, /storefrontCanvas/);
  assert.match(page, /Редагуйте текст прямо на макеті/);
  assert.match(page, /href="\/staff\/tariffs"/);
  assert.match(page, /Редагувати тарифи/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/structure"/);
  assert.match(shell, /Публічна вітрина/);
  assert.match(shell, /Редактор вітрини/);
});

test("landing pulls storefront config from the API and gates on published", async () => {
  const html = await read("public/site/index.html");
  assert.match(html, /fetch\('\/api\/site-content'/);
  assert.match(html, /c\.published===false/); // draft → placeholder
  assert.match(html, /id="scSlogan"/);
  assert.match(html, /id="scAbout"/);
});

test("stage 2: color and storefront type are validated while logo stays disabled", () => {
  const ok = sanitizeSiteContent({ brandColor: "#2F8F46", logoUrl: "https://x.co/l.png", storefrontType: "paid_only" });
  assert.equal(ok.brandColor, "#2f8f46"); // normalized lowercase
  assert.equal(ok.logoUrl, "");
  assert.equal(ok.storefrontType, "paid_only");
  const bad = sanitizeSiteContent({ brandColor: "red", logoUrl: "javascript:alert(1)", storefrontType: "weird" });
  assert.equal(bad.brandColor, SITE_CONTENT_DEFAULTS.brandColor); // invalid hex → default
  assert.equal(bad.logoUrl, "");
  assert.equal(bad.storefrontType, "paid_and_free"); // unknown → default
});

test("landing themes via CSS variable, honors storefront type and has no logo", async () => {
  const html = await read("public/site/index.html");
  assert.match(html, /--brand:#0c7a85/); // змінна визначена
  assert.match(html, /setProperty\('--brand',c\.brandColor\)/); // застосування кольору
  assert.match(html, /storefrontType==='paid_only'/); // ховає картку військових
  assert.match(html, /id="scMilCard"/);
  assert.doesNotMatch(html, /id="scLogo"|brand-logo/);
  // Колірні літерали замінено на var(--brand) — лишились тільки meta + визначення змінної.
  assert.ok((html.match(/#0c7a85/g) || []).length <= 2);
});

test("legacy logo values are ignored", () => {
  const small = "data:image/png;base64," + "A".repeat(1000);
  assert.equal(sanitizeSiteContent({ logoUrl: small }).logoUrl, "");
  assert.equal(sanitizeSiteContent({ logoUrl: "https://x.co/l.svg" }).logoUrl, "");
});

test("price/military pages pull content and theme from the editor via the API", async () => {
  const dept = await read("public/site/assets/department.js");
  assert.match(dept, /fetch\('\/api\/site-content'\)/); // єдине джерело, як на головній
  assert.match(dept, /applySiteContent/);
  // Тексти груп «Сторінка цивільних» і «Сторінка військових» застосовуються.
  for (const id of ["scPriceTitle", "scPriceIntro", "scPriceLead", "scMilPageTitle", "scMilNotice", "scMilLead"]) {
    assert.match(dept, new RegExp(`'${id}'`), `${id} applied`);
  }
});

test("paid_only storefront rejects military bookings server-side", async () => {
  const route = await read("app/api/site-booking/route.ts");
  // Читає режим вітрини й відхиляє військову категорію при paid_only.
  assert.match(route, /parseSiteContent\(await getSetting\(db, SITE_CONTENT_KEY\)\)/);
  assert.match(route, /category === "military"/);
  assert.match(route, /storefrontType === "paid_only"/);
  assert.match(route, /status: 403/);
});

test("paid_only storefront redirects the military page to the price page", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /storefrontPaidOnly/); // хелпер читання режиму
  assert.match(worker, /storefrontType === "paid_only"/);
  // Прямий вхід на military.html і /booking?category=military → прайс.
  assert.match(worker, /url\.pathname === "\/site\/military\.html"/);
  assert.match(worker, /category"\) === "military"/);
  assert.match(worker, /\/site\/price\.html/);
});

test("visual storefront editor keeps appearance fixed and structure available below", async () => {
  const page = await read("app/staff/structure/page.tsx");
  assert.match(page, /title="Публічна вітрина"/);
  assert.match(page, /Службова структура відділення/);
  assert.match(page, /sfStats/);
  assert.match(page, /siteContent/);
  assert.doesNotMatch(page, /storefrontType/);
  assert.doesNotMatch(page, /type="color"|logoUrl|onLogoFile|type="file"/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /Редактор вітрини/);
});
