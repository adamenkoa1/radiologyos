# Стилі RadiologyOS — зони та дизайн-токени

Єдиний **довідник реалізації** CSS: де що лежить і де які токени визначені.
Це карта коду (не принципи — принципи див. [`design-system.md`](./design-system.md)).
Значення тут **дзеркалять `app/styles/*.css`** — редагуйте CSS, а потім цей файл.

## Як влаштовані стилі

- `app/globals.css` — **лише індекс `@import`** зон із `app/styles/`. Порядок
  `@import` = порядок каскаду. Редагуйте відповідну зону, а не список.
- Зони **навмисно розбиті** за екраном/темою; це не хаос, а шари. Кілька зон
  свідомо перевизначають токени (теми) — див. нижче.
- Тести пінять інваріанти: `tests/workspace-design-system.test.mjs` (12 після
  02), `tests/maintenance.test.mjs` (globals імпортує 19), `tests/helpers/css.mjs`
  конкатенує зони в порядку `@import`.
- `tests/dead-css.test.mjs` — охоронець від невживаних класів (база відомого
  legacy-мертвого CSS у `tests/fixtures/dead-css-baseline.json`).

## Карта зон

Скоуп: **public** — публічний сайт/лендинг; **ws** — кабінет (`.workspaceShell`);
**theme** — перевизначає токени поверх ws.

| Файл | Скоуп | Призначення |
|---|---|---|
| `01-base.css` | root/public/ws | `@font-face`, `:root`-палітра сайту, шрифти, поля; логін, лендинг-картки, кабінет пацієнта, застарілі staff-екрани v1; оголошує `.workspaceShell`. |
| `02-workspace.css` | **ws** | **Примітивна шкала токенів** (тип/простір/радіус/тінь/рух/модальності) + базовий воркспейс-каркас, картки `.ds-*`. |
| `04-forms.css` | ws | Уніфіковані поля форм кабінету. |
| `05-tariffs.css` | ws | Екран тарифів. |
| `06-privat24-cards.css` | ws | «Приват24»-мова світлих карток для розділів. |
| `07-negatoscope.css` | **theme** | Негатоскоп-акцент: брендовий зелений → клінічний teal у кабінеті. |
| `08-dark-theme.css` | **theme** | Темна тема кабінету (`.themeDark`). |
| `09-records.css` | ws | «Записи»: таби, групи по днях. |
| `10-landing.css` | public | Комерційний лендинг (`.rosLanding`, токени `--ros-*`). |
| `11-command-palette.css` | ws | Командна палітра (⌘K). |
| `12-design-system.css` | **ws** | **Семантичний шар `--ws-*`**: статуси, іконки, поліш кнопок. Вантажиться останнім, щоб модернізувати кабінет без переписування legacy-CSS. |
| `13-dashboard-monitor.css` | ws | BAS-монітор керівника (`--dash-kpi`). |
| `14-resource-planner.css` | ws | Планувальник ресурсів (календар по обладнанню). |
| `15-study-kanban.css` | ws | Kanban клінічного циклу дослідження. |
| `16-tasks.css` | ws | Завдання персоналу. |
| `17-inventory.css` | ws | Склад/розхідники. |
| `18-contact-center.css` | ws | Контакт-центр / чат із пацієнтами. |
| `19-maintenance.css` | ws | Обслуговування обладнання. |
| `20-finance.css` | ws | Фінансовий журнал у стилі BAS + друковані чеки. |
| `21-bas-shell.css` | ws | BAS-подібний enterprise-каркас. |
| `22-shift-calendar.css` | ws | Календар змін персоналу. |
| `23-bas-enterprise-density.css` | **theme** | Щільний BAS-режим (`.basWorkspaceShell`): власні `--bas-*` + компактні `--fs-*`/`--r-*`/`--ws-radius-*`. |
| `24-reports-minimal.css` | ws | Мінімалістичний екран «Звіти» (`--rp-*`). |
| `25-dashboard-journal.css` | ws | Пульт у єдиному журнальному стилі. |
| `26-intake-journal.css` | ws | Прийом у журнальному стилі. |
| `27-crm-protocol-journal.css` | ws | Пацієнти (CRM) + Протоколи, журнальний стиль. |
| `28-board-imaging-journal.css` | ws | Дошка досліджень у бренд-кольорі. |
| `29-seo-audit.css` | ws | SEO-аудит (`/staff/reports/seo`): аналітичний дашборд на `--status-*`/`--ws-*`. |

> Нумерація має пропуск на `03` (стару публічну тему `.publicShell` прибрано як
> мертву). Пропуск нешкідливий — назви файлів пінять тести, тож перенумеровувати
> не варто.

## Дизайн-токени

Значення — базові (світлий режим). Теми (`07`, `08`, `12.themeDark`, `23`)
перевизначають частину — див. «Перевизначення темами». За рівної специфічності
(`.workspaceShell`) виграє токен із **пізнішої** зони за `@import`.

### 1. Публічний сайт — `:root` (`01-base.css`)

Палітра маркетингу/сайту та спільні шрифти й поля.

| Токен | Значення |
|---|---|
| `--ink` | `#142d2b` |
| `--green` | `#0d5b50` |
| `--mint` | `#d9f0e9` |
| `--paper` | `#f5f3ed` |
| `--sand` | `#e9e4d8` |
| `--orange` | `#ee744c` |
| `--field-border` | `#d7ddd4` |
| `--field-bg` | `#fff` |
| `--field-radius` | `8px` |
| `--field-pad` | `11px 12px` |
| `--font-sans` | `"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` |
| `--font-serif` | `"Lora Variable", Georgia, "Times New Roman", serif` |

Каркас кабінету оголошується там само на `.workspaceShell`:
`--workspace-sidebar:244px`, `--dash-w:min(2560px,100%)`, `--ws-brand:#123d3a`,
`--ws-brand-deep:#0d302e`, `--ws-accent:#ef744d`.

### 2. Примітивна шкала кабінету — `.workspaceShell` (`02-workspace.css`)

Єдина основа: типографіка, 8pt-простір, радіуси, тіні, рух, кольори модальностей.

| Група | Токени (значення) |
|---|---|
| Типографіка | `--fs-display:48px` · `--fs-h1:36px` · `--fs-h2:28px` · `--fs-h3:22px` · `--fs-lg:18px` · `--fs-base:16px` · `--fs-sm:14px` · `--fs-xs:12px` · `--lh-tight:1.15` · `--lh-base:1.5` |
| Простір (8pt) | `--sp-1:4px` · `--sp-2:8px` · `--sp-3:12px` · `--sp-4:16px` · `--sp-5:20px` · `--sp-6:24px` · `--sp-8:32px` · `--sp-10:40px` · `--sp-12:48px` |
| Радіуси | `--r-xs:6px` · `--r-sm:8px` · `--r-md:12px` · `--r-lg:16px` · `--r-xl:20px` · `--r-pill:999px` |
| Тіні | `--sh-1:0 1px 2px rgba(16,32,44,.05)` · `--sh-2:0 4px 14px rgba(20,40,35,.08)` · `--sh-3:0 12px 40px rgba(16,32,30,.16)` |
| Рух | `--dur-fast:150ms` · `--dur-base:250ms` · `--ease:cubic-bezier(.2,.6,.2,1)` |
| Модальності | `--mod-ct:#2f7db0` · `--mod-xray:#5a37a3` · `--mod-fluoro:#b5761a` · `--mod-us:#0e8f8a` · `--mod-other:#8a9995` · `--mod-contrast:#7048c4` · `--mod-urgent:#dc4b3e` |

> Модальності — **єдине джерело правди**; колір не замінює текстову назву.

### 3. Семантичний шар — `.workspaceShell` (`12-design-system.css`)

Завантажується останнім із базових. Семантичні ролі, статуси, іконки.

| Група | Токени (значення) |
|---|---|
| Ролі | `--ws-accent:#2563eb` · `--ws-accent-soft:#eff6ff` · `--ws-positive:#15803d` · `--ws-warning:#b45309` · `--ws-danger:#b91c1c` · `--ws-ink:#172033` · `--ws-muted:#667085` · `--ws-line:#e4e7ec` · `--ws-surface:#ffffff` · `--ws-surface-subtle:#f8fafc` |
| Радіуси | `--ws-radius-sm:8px` · `--ws-radius-md:12px` |
| Тіні | `--ws-shadow-sm:0 1px 2px rgba(16,24,40,.04),0 1px 3px rgba(16,24,40,.08)` · `--ws-shadow-md:0 8px 24px rgba(16,24,40,.08)` |
| Статуси (bg/fg/line) | `--status-ok-*` (`#e9f3ee`/`#166a46`/`#2f9e6e`) · `--status-warn-*` (`#fdf3e1`/`#8a5411`/`#d99a2b`) · `--status-alert-*` (`#fcebe8`/`#a1301b`/`#d1442b`) |
| Іконки (маска по currentColor) | `--icon-ok` · `--icon-warn` · `--icon-alert` (inline-SVG data-URI) |

### 4. Локальні / модульні токени

Живуть у своїй зоні й нікуди не «підіймаються»:

- `10-landing.css` — `--ros-*` (лендинг, скоуп `.rosLanding`).
- `24-reports-minimal.css` — `--rp-*` (екран «Звіти»).
- `23-bas-enterprise-density.css` — `--bas-*` (щільний режим, скоуп `.basWorkspaceShell`).
- `13-dashboard-monitor.css` — `--dash-kpi`.
- `--ws-nav-icon` — маска nav-іконки, задається локально в `12/15/16/17`.
- `06-privat24-cards.css` — локальний `--field-radius`.

### Перевизначення темами

| Тема (файл, селектор) | Що перевизначає |
|---|---|
| Негатоскоп (`07`, `.workspaceShell`) | `--green`/`--ws-accent`→`#0c7a85` (teal), `--ws-deep`, `--ws-soft`, `--ws-sidebar`. |
| Темна (`08`, `.workspaceShell.themeDark`) | `--green`/`--ws-accent`→`#25b4c0`, `--ws-deep`, `--ws-soft`, `--ink`. |
| Темна (`12`, `.workspaceShell.themeDark`) | `--ws-ink/muted/line/surface/surface-subtle`, `--ws-shadow-*`, `--status-*` (нічні відтінки). |
| Щільна (`23`, `.basWorkspaceShell`) | компактні `--fs-*`, `--r-*`, `--ws-radius-sm/md`, `--ws-shadow-*`, `--workspace-sidebar:224px`. |

## Дублювання, про яке варто знати

Історично склалося два паралельні набори під `.workspaceShell`; **значення не
змінюємо**, але при новому коді обирайте семантику:

- Радіуси: `--r-md:12px` (02) ≡ `--ws-radius-md:12px` (12). Для нового —
  `--ws-radius-*` (семантика), для примітивів — `--r-*`.
- Тіні: `--sh-1..3` (02) та `--ws-shadow-sm/md` (12) — близькі шкали; у
  дизайн-системних компонентах беріть `--ws-shadow-*`.

## Конвенції

- **Новий токен** — у зону, що ним володіє: примітив → `02`; семантика `--ws-*`
  → `12`; локальний до екрана → його зона.
- **Не переносьте** визначення між зонами: скоуп і порядок `@import` — навмисні,
  а тести пінять каскад. Переміщення `--ws-radius-md`/`--ws-accent` зламає теми.
- Значення — тільки в CSS; цей файл лише дзеркалить їх.
