// Публічний запис — мінімалістичний месенджер-хендоф: пацієнт обирає
// дослідження, вказує лише ПІБ + бажану дату й час і надсилає заявку у
// Viber/WhatsApp або телефонує. Жодного запису в БД, телефону/пошти/дати
// народження, реєстрації кабінету чи передоплати на публічному сайті.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const FORMS = ["public/site/index.html", "public/site/price.html", "public/site/military.html"];

test("booking forms keep only ПІБ + бажана дата + бажаний час", async () => {
  for (const page of FORMS) {
    const html = await read(page);
    const mil = page.includes("military");
    const nameId = mil ? "militaryPatientName" : "patientName";
    const dateId = mil ? "militaryDesiredDate" : "desiredDate";
    const timeId = mil ? "militaryDesiredTime" : "desiredTime";
    assert.match(html, new RegExp(`id="${nameId}"`), `${page}: ПІБ`);
    assert.match(html, new RegExp(`id="${dateId}"[^>]*type="date"`), `${page}: дата`);
    assert.match(html, new RegExp(`id="${timeId}"[^>]*type="time"`), `${page}: час`);
    // Прибрані поля.
    for (const gone of ["PatientPhone", "PatientDob", "PatientEmail", "PatientContact", "patientCategory", "dataConsent", "militaryConsent", "militaryComment", 'id="comment"']) {
      assert.doesNotMatch(html, new RegExp(gone), `${page}: лишилося прибране поле ${gone}`);
    }
  }
});

test("each form offers Viber, WhatsApp and a call button", async () => {
  for (const page of FORMS) {
    const html = await read(page);
    // Мінімалістичний блок: заголовок + три круглі іконки з підписами.
    assert.match(html, /class="book-channels-title">Записатися через</);
    assert.match(html, /class="channel-btn viber" data-book="viber" aria-label="Записатися через Viber"/);
    assert.match(html, /class="channel-btn whatsapp" data-book="whatsapp" aria-label="Записатися через WhatsApp"/);
    assert.match(html, /class="channel-btn call" href="tel:\+380972808899" aria-label="Зателефонувати"/);
    // Підписи під іконками.
    for (const cap of ["Viber", "WhatsApp", "Дзвінок"]) {
      assert.match(html, new RegExp(`class="channel-cap">${cap}<`));
    }
  }
});

test("no prepayment / QR / auto-cabinet on the public booking flow", async () => {
  for (const page of FORMS) {
    const html = await read(page);
    assert.doesNotMatch(html, /payBlock|payQr|payBtn|Оплатити \(ПриватБанк\)/, `${page}: лишилась оплата`);
    assert.doesNotMatch(html, /cabinet\.html\?new=1/, `${page}: авто-кабінет`);
    assert.match(html, /Оплата — після проведення дослідження|Оплата не потрібна/, `${page}: примітка про оплату`);
    // Кабінет — лише необов'язкове другорядне посилання.
    assert.match(html, /class="cabinet-link" href="\/site\/cabinet\.html">Створити особистий кабінет/);
  }
});

test("the client no longer posts to /api/site-booking (messenger handoff)", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.doesNotMatch(bridge, /\/api\/site-booking/);
  assert.doesNotMatch(bridge, /postBooking|idempotency-key|dob-widget/);
});

test("d1-bridge builds the request message and validates before opening a messenger", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /Добрий день! Хочу записатися на дослідження\./);
  assert.match(bridge, /Пацієнт: \$\{name\}/);
  assert.match(bridge, /Дослідження: \$\{studies\.join\(', '\)\}/);
  assert.match(bridge, /Бажана дата: /);
  assert.match(bridge, /Бажаний час: /);
  // Гейт: без досліджень/ПІБ/дати/часу месенджер не відкривається.
  assert.match(bridge, /if \(!studies\.length\)/);
  assert.match(bridge, /if \(!name\)/);
  assert.match(bridge, /if \(!date\)/);
  assert.match(bridge, /if \(!time\)/);
  assert.match(bridge, /if \(!data\) return;/);
});

test("WhatsApp uses wa.me with URL-encoded text; Viber copies to clipboard with a toast", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /https:\/\/wa\.me\/\$\{ADMIN_PHONE_INTL\}\?text=\$\{encodeURIComponent\(text\)\}/);
  assert.match(bridge, /ADMIN_PHONE_INTL = '380972808899'/);
  assert.match(bridge, /copyText\(text\)/);
  assert.match(bridge, /Текст заявки скопійовано\. Вставте його у повідомлення Viber/);
  assert.match(bridge, /viber:\/\/chat\?number=%2B\$\{ADMIN_PHONE_INTL\}/);
});

test("after opening a messenger the form shows a confirmation with copy/call fallback", async () => {
  const bridge = await read("public/site/assets/d1-bridge.js");
  assert.match(bridge, /function showBookConfirm\(/);
  assert.match(bridge, /showBookConfirm\(form, 'WhatsApp', text\)/);
  assert.match(bridge, /showBookConfirm\(form, 'Viber', text\)/);
  assert.match(bridge, /Майже готово/);
  assert.match(bridge, /book-confirm-copy/);
  assert.match(bridge, /href="tel:' \+ ADMIN_TEL/);
});

test("booking cart explains the estimate and the optional cabinet", async () => {
  for (const page of ["public/site/index.html", "public/site/price.html"]) {
    const html = await read(page);
    assert.match(html, /class="cart-total-note">Орієнтовна вартість/, `${page}: sum note`);
  }
  for (const page of FORMS) {
    const html = await read(page);
    assert.match(html, /class="cabinet-note">Необов'язково/, `${page}: cabinet note`);
  }
});

test("home page has one primary CTA and a single FAQ accordion", async () => {
  const html = await read("public/site/index.html");
  assert.match(html, /class="hero-cta" href="\/site\/price\.html">Записатися на дослідження/);
  assert.match(html, /class="faq-heading">Часті запитання/);
  // Ексклюзивний accordion: усі details мають name="faq" (відкрито не більше одного).
  const faqDetails = (html.match(/<details name="faq"/g) || []).length;
  assert.ok(faqDetails >= 3, `очікували ≥3 FAQ-пункти, знайдено ${faqDetails}`);
});
