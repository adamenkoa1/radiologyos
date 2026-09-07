// Тест-охоронець мертвого CSS.
//
// Збирає всі класи, оголошені в app/styles/*.css, і звіряє їх зі всім вихідним
// кодом (app, public, lib, tests, scripts, worker, db). Клас без жодного
// посилання — «мертвий» і лише роздуває бандл кабінету.
//
// Мета — не разова чистка, а ЗАМОК: список відомого legacy-мертвого CSS
// зафіксовано у tests/fixtures/dead-css-baseline.json. Тест падає, якщо:
//   • з'явився НОВИЙ мертвий клас (треба або прибрати його, або, якщо він
//     справді потрібен, переконатися, що на нього десь є посилання);
//   • класу з базового списку більше немає серед мертвих (його прибрали або
//     він знову вживається) — тоді треба видалити рядок із базового списку,
//     щоб той лишався чесним.
//
// Базовий список зберігаємо у .json навмисно: детектор сканує tests/*.mjs,
// тож імена класів у коді тесту зробили б їх «живими». JSON у корпус не
// потрапляє (скануються лише .mjs/.ts/.js).
//
// Динамічно складені сімейства (`st-${status}`, `kind-${shift.kind}` тощо)
// не є мертвими — їхні префікси перелічені в DYNAMIC_PREFIXES (див.
// tests/helpers/dead-css.mjs) і вважаються живими.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { findDeadClasses } from "./helpers/dead-css.mjs";

const baseline = JSON.parse(
  await readFile(new URL("./fixtures/dead-css-baseline.json", import.meta.url), "utf8"),
);

test("нового мертвого CSS не з'явилося понад зафіксований базовий список", () => {
  const { dead } = findDeadClasses();
  const known = new Set(baseline);
  const current = new Set(dead);

  const appeared = dead.filter((c) => !known.has(c)); // новий мертвий CSS
  const cleaned = baseline.filter((c) => !current.has(c)); // прибрано/ожив

  assert.deepEqual(
    appeared,
    [],
    `З'явився новий мертвий CSS-клас (немає жодного посилання в коді). ` +
      `Приберіть селектор із app/styles/ або, якщо клас справді потрібен, ` +
      `переконайтеся, що він десь використовується: ${appeared.join(", ")}`,
  );

  assert.deepEqual(
    cleaned,
    [],
    `Ці класи більше не мертві (прибрані або знову вживані) — вилучіть їх із ` +
      `tests/fixtures/dead-css-baseline.json: ${cleaned.join(", ")}`,
  );
});

test("базовий список відсортований і без дублікатів", () => {
  const sorted = [...baseline].sort();
  assert.deepEqual(baseline, sorted, "tests/fixtures/dead-css-baseline.json має бути відсортований");
  assert.equal(new Set(baseline).size, baseline.length, "у базовому списку є дублікати");
});
