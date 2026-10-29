import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("product CTAs open WhatsApp and ask to confirm current availability", async () => {
  const page = await read("app/product/page.tsx");
  assert.match(page, /const whatsappHref = \(message: string\).*encodeURIComponent\(message\)/);
  assert.equal(page.includes('href="https://wa.me/380972808899"'), false, "all WhatsApp links use the prefilled helper");
  assert.match(page, /className="rosBtn" href=\{whatsappHref\(contactMessage\)\}/);
  assert.match(page, /className="rosBtn rosBtnLg" href=\{whatsappHref\(contactMessage\)\}/);
  assert.ok(page.includes('href={whatsappHref(`Добрий день! Хочу обговорити RadiologyOS для формату «${a.title}».`)}'));
  assert.match(page, /href=\{whatsappHref\(pricingMessage\)\}/);
  assert.match(page, />Уточнити умови й вартість<\/a>/);
  assert.match(page, /Публічні тарифи й ціни ще не підтверджені/);
});

test("product page does not promise unavailable customer features or unverified prices", async () => {
  const page = await read("app/product/page.tsx");
  const positiveClaims = page.slice(page.indexOf("const features"), page.indexOf("const featureStatus"));
  for (const claim of ["DICOM/PACS", "Excel", "зарплат", "24/7", "price:\"990\""]) {
    assert.equal(positiveClaims.toLowerCase().includes(claim.toLowerCase()), false, `unverified positive claim: ${claim}`);
  }
  assert.match(page, /name:"DICOM\/PACS", note:"внутрішній модуль є; потрібне налаштування PACS"/);
  assert.match(page, /name:"Звіти Excel", note:"XLSX-експорт є для дозволених ролей персоналу"/);
  assert.match(page, /name:"Розрахунок зарплати", note:"готовий модуль не підтверджено"/);
  assert.match(page, /name:"Підтримка 24\/7", note:"графік підтримки не підтверджено"/);
  assert.equal(page.includes("const tiers ="), false, "unconfirmed pricing tiers are hidden");
});

test("calculator is labeled as an estimate, not a promise of reminder outcomes", async () => {
  const page = await read("app/product/page.tsx");
  assert.match(page, /не є виміряною статистикою чи прогнозом ефекту від нагадувань/);
  assert.match(page, /не є обіцянкою економії чи повернення коштів/);
});

test("audience and final CTAs invite a scoped consultation", async () => {
  const page = await read("app/product/page.tsx");
  assert.match(page, /cta:"Обговорити для клініки"/);
  assert.match(page, /cta:"Обговорити для КТ-кабінету"/);
  assert.match(page, /cta:"Обговорити для лікаря"/);
  assert.match(page, /Потрібна консультація\?/);
  assert.match(page, /Підтвердимо доступні модулі/);
});
