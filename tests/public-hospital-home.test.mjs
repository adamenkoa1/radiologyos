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
