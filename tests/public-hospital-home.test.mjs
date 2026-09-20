import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the public homepage combines hospital information, services and booking", async () => {
  const page = await read("public/site/index.html");
  for (const marker of [
    "scSlogan",
    "scAbout",
    "Флюорографія, рентгенографія та КТ у Чернігові",
    "29 700",
    "16 500",
    "10 400",
    "2 800",
    "80 досліджень щодня",
    "Військовослужбовцям",
    "Цивільним особам",
    "Режим роботи",
    "scPhoneLink",
    "tel:\\+380972808899",
    "Номер скопійовано",
    "/staff/login",
  ]) assert.match(page, new RegExp(marker));
  assert.doesNotMatch(page, /Дослідження та вартість|homeTariffs/);
  assert.doesNotMatch(page, /scLogo|brand-logo/);
  assert.match(page, /\/api\/site-content/);
  assert.match(page, /\/api\/department-profile/);
  assert.match(page, /Екстрені дослідження для військовослужбовців/);
  const contentDefaults = await read("public/site/assets/department.js");
  assert.match(contentDefaults, /08:30–17:30/);
  assert.match(contentDefaults, /Досвід, якому можна довіряти/);
});

test("homepage IA: for-whom → modalities → how-to-book → about → FAQ → contacts", async () => {
  const page = await read("public/site/index.html");
  // Порядок секцій головної (за зростанням позиції у розмітці).
  const order = [
    'class="hero-lead"',
    'class="hero" aria-label="Кому підходить"',
    'id="modalities"',
    'class="how-section" id="how"',
    '<section class="experience" id="experience"',
    'id="faq"',
    'id="contacts"',
  ];
  let prev = -1;
  for (const marker of order) {
    const at = page.indexOf(marker);
    assert.ok(at > prev, `секція "${marker}" має йти після попередньої (знайдено на ${at}, попередня ${prev})`);
    prev = at;
  }
  // Сценарії «Як записатися» показані розгорнуто, а не в акордеонах.
  assert.doesNotMatch(page, /fold-card audience-how/);
  assert.match(page, /class="how-card military-how"/);
  assert.match(page, /class="how-card civilian-how"/);
  // Блок «Про відділення» — звичайна картка, не згорнутий accordion
  // (FAQ нижче лишається акордеоном — це навмисно).
  assert.match(page, /<section class="experience" id="experience">\s*<div class="wrap">\s*<div class="experience-card">/);
  // Секція модальностей перелічує погоджені дослідження без цін/тарифів.
  assert.match(page, /class="modality-list"/);
  for (const m of ["Флюорографія", "Цифрова рентгенографія", "Рентгенографія з барієм", "Комп’ютерна томографія", "контрастуванням"]) {
    assert.match(page, new RegExp(m), `модальність: ${m}`);
  }
  // SEO: модальності лінкуються на посадкові сторінки (внутрішня перелінковка,
  // без хвостового слеша — канонічна форма, що віддає 200 без редиректу).
  assert.match(page, /<a href="\/fluorography">Флюорографія<\/a>/);
  assert.match(page, /<a href="\/xray">Цифрова рентгенографія<\/a>/);
  assert.match(page, /<a href="\/ct">Комп’ютерна томографія \(КТ\)<\/a>/);
  assert.match(page, /<a href="\/ct\/contrast">КТ з внутрішньовенним контрастуванням<\/a>/);
});

test("public booking is a minimalist messenger handoff (name + date + time)", async () => {
  const page = await read("public/site/index.html");
  assert.match(page, /Прізвище, ім’я та по батькові/);
  assert.match(page, /id="desiredDate"[^>]*type="date"/);
  assert.match(page, /id="desiredTime"[^>]*type="time"/);
  // Прибрано складні поля.
  assert.doesNotMatch(page, /id="patientPhone"|id="patientDob"|id="patientCategory"/);
  // Одна головна CTA веде до вибору досліджень.
  assert.match(page, /class="hero-cta" href="\/site\/price\.html">Записатися на дослідження/);
});
