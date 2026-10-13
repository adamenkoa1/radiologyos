# Protocol Builder — MASTER PROMPT 3 audit journal (F1 → E → F2)

Журнал виконання MASTER PROMPT 3 для `/staff/protocols`. Веде фактичний стан,
перевірки та рішення. Канонічні правила — `AGENTS.md`; план конструктора —
`docs/protocols-constructor.md`.

## 0. Базовий стан (перевірено, не зі слів звіту)

Станом на початок MP3, гілка `main` @ `8a688ed` (після злиття D5c #659).

**PR Этапу D — усі злиті в `main` (перевірено через GitHub API):**

| PR | Крок | Міграція | Стан |
|----|------|----------|------|
| #651 | C — конструктор знахідок (§5) | — | merged |
| #652 | D1 — каталог 3→7 + підказки (§4) | — | merged |
| #653 | D2 — жива панель прев'ю (§3) | — | merged |
| #654 | D3 — режими роботи (§6) | — | merged |
| #655 | D4a — синхронізація workflows.md | — | merged |
| #656 | D4b — умовні секції (§4) | — | merged |
| #657 | D5a — method_ref у ревізіях | `0122` | merged + deploy success (run 347) |
| #658 | D5b — персональні макроси (§7) | `0123` | merged + deploy success |
| #659 | D5c — персональні повні шаблони (§7) | `0124` | merged |

**Міграції** (протокольний арк): `0122` (method_ref у protocol_revisions),
`0123` (protocol_macros), `0124` (protocol_user_templates). Drizzle-метадані
rebaselined; `db:generate` — no-op (guard `tests/drizzle-generation-guard`).

**Гейт** на цьому дереві: `tsc --noEmit` чисто; `npm run lint` 0 errors
(40 baseline warnings); `npm test` — 1364/1364 (перевірено повторним запуском).

**Фактична архітектура `/staff/protocols`** (підтверджено читанням коду):
двопанельний редактор (черга + редактор) у `app/staff/protocols/page.tsx`;
lifecycle `draft→ready→signed→issued` з DB-тригерами незмінності (0043–0107,
+0122); шаблони в коді (`lib/protocols.ts`, 14 шт.) + умовні поля (`showWhen`);
конструктор знахідок (`lib/findings-composer.ts`, 7 ділянок); режими Швидкий/
Структурований/Вільний; жива панель прев'ю; персональні макроси й шаблони; AI —
детермінована offline heuristic-чернетка (`lib/ai.ts`) з дисклеймером, без
автопідпису. Повний опис — `docs/protocols-constructor.md`.

## F1 — браузерна перевірка

### F1.1 Авторизований браузер — **СТАТУС: BLOCKED (середовище)**

Авторизований браузер проти `/staff/protocols` **недоступний у цьому
середовищі**. Причину встановлено емпірично, не припущенням:

1. **`npm run dev` (vite + @cloudflare/vite-plugin):** worker віддає 500 на
   `env.ASSETS.fetch` (`worker/index.ts:182`) — binding `ASSETS` не заповнений
   у sandbox.
2. **`npm run start` (`vinext start`, прод-сервер на :3000):** кожен маршрут
   (включно з `/`, `/staff/login`, `/staff/protocols`, `/api/staff/protocols`)
   віддає **HTTP 500** з
   `TypeError: Cannot read properties of undefined (reading 'DB')`
   (`dist/server/index.js` → `vinext/dist/server/prod-server.js`). Тобто
   `vinext start` — це звичайний Node-сервер **без Cloudflare-bindings**:
   `env` відсутній, `env.DB`/`env.ASSETS` недоступні.
3. **Playwright-модуль не встановлено** (`require('playwright')` →
   `MODULE_NOT_FOUND`); у середовищі є лише бінарник Chromium
   (`/opt/pw-browsers`), не драйвер.

Отже жоден локальний сервер не надає D1/ASSETS-bindings, тож ані публічні, ані
`/staff/*` сторінки не рендеряться локально. Єдине середовище з реальними
bindings — Cloudflare production (`radiologyos.tech`), яке MP3 прямо забороняє
використовувати для обходу авторизації та змінювати без окремого дозволу; реальні
дані пацієнтів використовувати заборонено.

**Чесний висновок:** F1 (жива авторизована браузерна перевірка) **не завершено**
і позначено BLOCKED. Жодних тверджень про проходження живих E2E не роблю.

### Інструкція усунення блокера (будь-який з варіантів)

1. **Staging/preview з реальними bindings.** Розгорнути гілку на Cloudflare
   Workers preview (`wrangler versions upload` / preview-деплой), отримати URL і
   тестовий staff-логін (НЕ production, НЕ реальні пацієнти). Далі:
   `E2E_BASE_URL=<preview-url> E2E_STAFF_EMAIL=<test> E2E_STAFF_PASSWORD=<test>
   npm run test:e2e`.
2. **Локальний wrangler із local D1 + ASSETS.** Запустити `wrangler dev
   --local --persist-to .wrangler/state --config wrangler.cloudflare.toml` проти
   зібраного воркера так, щоб `env.DB` (local D1) і `env.ASSETS` були заповнені;
   застосувати міграції `drizzle/*.sql` у local D1; засіяти org+staff+
   staff_session (аналогічно `tests/helpers/d1.mjs`); виставити session-cookie й
   запустити `E2E_BASE_URL=http://127.0.0.1:<port> E2E_STAFF_COOKIE=<cookie>
   npm run test:e2e`.

### F1 harness (готовий, запускається після усунення блокера)

`tests/e2e/protocol-scenarios.e2e.mjs` — автономний Playwright-раннер:
- **НЕ входить у `npm test`** (unit-гейт — `tests/*.test.mjs`, не рекурсивно; це
  `.e2e.mjs` у підтеці), не ламає CI, не має статичних імпортів відсутніх
  модулів (динамічний `import('playwright')`);
- якщо немає `E2E_BASE_URL` або модуля `playwright` — друкує
  `E2E SKIPPED — F1 BLOCKED` і виходить 0 (чесно, без фальшивого проходження);
- за наявності середовища: авторизується (cookie або форма `/staff/login`),
  відкриває `/staff/protocols`, виконує UI-чек-ліст і клінічний Сценарій 1
  (КТ ОГК, права нижня частка, S7–S10, гіперпневматизація, −952 HU), зберігає
  скриншоти у `tests/e2e/artifacts/`, перевіряє відсутність авто-«вродженого»
  характеру;
- запуск: `npm run test:e2e`.

### Покриття клінічних сценаріїв F1.3 поточним конструктором (матриця)

| # | Сценарій | Покриття каталогом зараз | Примітка |
|---|----------|--------------------------|----------|
| 1 | КТ ОГК гіперпневматизація S7–S10 | **повне** (lung/hyperpneumatization + сегменти + HU + модифікатори) | еталон §5 відтворюється дослівно |
| 2 | Пневмонія (інфільтрація+консолідація+бронхограма+матове скло, полісегментарна, висновок) | **часткове** (є infiltration, ground_glass; немає складеного висновку «полісегментарна пневмонія») | кандидат на розширення каталогу/висновків |
| 3 | КТ хребта L3–L4/L4–L5 протрузії + стеноз | **часткове** (є disc protrusion/herniation, canal stenosis; рівні L3–L4 не як структурований параметр) | рівні — окремий параметр, не морфологія |
| 4 | КТ мозку субарахноїдальні простори/атрофія | **часткове** (є atrophy, midline_shift; «не встановлювати атрофію мозочка авто» — ок, нічого не автозаповнюється) | |
| 5 | КТ травма: перелом C6 + стороннє тіло | **немає** (перелом хребця загальний; стороннє тіло/рівні C не модельовано) | кандидат на нову ділянку |
| 6 | КТ ОЧП гепатомегалія/стеатоз/асцит | **часткове** (є liver steatosis, free fluid/ascites, spleen; гепатомегалія/жовчний окремо) | конструктор нічого не додає авто — ок |

Матриця живить майбутні PR розширення (поза F1a; F1a — середовище + harness +
чесний запис). Жодна знахідка не формується автоматично без вибору лікаря, тож
інваріант «не вигадувати» виконується вже зараз.

## Журнал PR

- **F1a** (цей PR): журнал аудиту + BLOCKED-визначення F1 + готовий Playwright-
  harness (skip-when-blocked) + `test:e2e` + матриця покриття сценаріїв. Без
  зміни рантайму застосунку; гейт зелений.
