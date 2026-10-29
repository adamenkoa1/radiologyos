import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("product signup and plan actions open WhatsApp with context", async () => {
  const page = await read("app/product/page.tsx");
  assert.match(page, /const whatsappHref = \(message: string\).*encodeURIComponent\(message\)/);
  assert.equal(page.includes('href="https://wa.me/380972808899"'), false, "all WhatsApp links use the prefilled helper");
  assert.match(page, /className="rosBtn" href=\{whatsappHref\(contactMessage\)\}/);
  assert.match(page, /className="rosBtn rosBtnLg" href=\{whatsappHref\(contactMessage\)\}/);
  assert.ok(page.includes('href={whatsappHref(`Добрий день! Хочу обговорити RadiologyOS для формату «${a.title}».`)}'));
  assert.ok(page.includes('href={whatsappHref(`Добрий день! Хочу уточнити умови тарифу «${t.name}» RadiologyOS.`)}'));
  assert.match(page, /rosBtnOutline" href=\{whatsappHref\(contactMessage\)\}/);
  assert.match(page, />Запитати про тариф<\/a>/);
});

test("product page does not promise a self-service trial or automatic signup payment", async () => {
  const page = await read("app/product/page.tsx");
  for (const claim of [
    "безкоштовного періоду",
    "Почати безкоштовно",
    "14 днів безкоштовно",
    "без картки",
    "оплата одразу після реєстрації",
    "скасування будь-коли",
    "знижкою 15%",
  ]) {
    assert.equal(page.toLowerCase().includes(claim.toLowerCase()), false, `stale claim: ${claim}`);
  }
});

test("audience and plan CTAs describe the WhatsApp consultation action", async () => {
  const page = await read("app/product/page.tsx");
  assert.match(page, /cta:"Обговорити для клініки"/);
  assert.match(page, /cta:"Обговорити для КТ-кабінету"/);
  assert.match(page, /cta:"Обговорити для лікаря"/);
  assert.match(page, /Потрібна консультація\?/);
  assert.match(page, /Напишіть нам, щоб уточнити умови тарифу та підключення\./);
});
