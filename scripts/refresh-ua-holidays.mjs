#!/usr/bin/env node
// Офлайн-оновлювач vendored-переліку державних свят України для виробничого
// (норм-)календаря. НЕ звертається до жодних зовнішніх сервісів: свята будуються
// з правил у lib/work-calendar.ts (фіксовані дати КЗпП ст. 73 + обчислені
// православні Великдень/Трійця) і вписуються назад у той самий файл між
// маркерами `ua-holidays:generated:start` / `ua-holidays:generated:end`.
//
// Використання:
//   node --experimental-strip-types scripts/refresh-ua-holidays.mjs [відРоку] [доРоку]
// Без аргументів: поточний рік … поточний+4.
//
// ВАЖЛИВО: після генерації звірте ФІКСОВАНІ дати із чинним законом — вони
// змінюються законодавчо (напр., День перемоги 8/9 травня). Рухомі свята
// (Великдень/Трійця) обчислюються точно.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateHolidays } from "../lib/work-calendar.ts";

const FILE = new URL("../lib/work-calendar.ts", import.meta.url);
const START = "// ua-holidays:generated:start";
const END = "// ua-holidays:generated:end";

const now = new Date().getUTCFullYear();
const from = Number(process.argv[2]) || now;
const to = Number(process.argv[3]) || from + 4;
if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1900 || to > 2099 || to < from) {
  console.error(`Некоректний діапазон років: ${from}..${to} (дозволено 1900..2099, відРоку ≤ доРоку).`);
  process.exit(1);
}

const years = [];
for (let y = from; y <= to; y += 1) years.push(y);

const entries = years.map((year) => {
  const rows = generateHolidays(year)
    .map((h) => `    { date: ${JSON.stringify(h.date)}, name: ${JSON.stringify(h.name)} },`)
    .join("\n");
  return `  ${year}: [\n${rows}\n  ],`;
}).join("\n");

const block = `${START}\nexport const UA_HOLIDAYS: Record<number, Holiday[]> = {\n${entries}\n};\n${END}`;

const source = await readFile(fileURLToPath(FILE), "utf8");
const startAt = source.indexOf(START);
const endAt = source.indexOf(END);
if (startAt === -1 || endAt === -1 || endAt < startAt) {
  console.error("Не знайдено маркерів ua-holidays:generated у lib/work-calendar.ts.");
  process.exit(1);
}
const next = source.slice(0, startAt) + block + source.slice(endAt + END.length);
await writeFile(fileURLToPath(FILE), next, "utf8");

console.log(`Оновлено UA_HOLIDAYS у lib/work-calendar.ts для років ${from}..${to} (${years.length}).`);
console.log("Нагадування: звірте фіксовані дати свят із чинним законом.");
