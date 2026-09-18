import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("landing has social preview + rich SEO markup", async () => {
  const html = await read("public/site/index.html");
  // OG / Twitter соцпрев'ю.
  assert.match(html, /property="og:image" content="https:\/\/radiologyos\.tech\/hospital-emblem\.jpg"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  // Гео-координати й карта у MedicalClinic JSON-LD.
  assert.match(html, /"@type":"GeoCoordinates","latitude":51\.4978508,"longitude":31\.3094428/);
  assert.match(html, /"hasMap":"https:\/\/www\.google\.com\/maps/);
  // FAQ: розмітка + видима секція.
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Скільки коштує КТ у Чернігові\?/);
  assert.match(html, /id="faq"/);
  // Довгі ключі: локація + модальності (лишаються в блоці «Про відділення»).
  assert.match(html, /КТ у Чернігові/);
  assert.match(html, /цифрова рентгенографія/);
});
