# RadiologyOS — матриця покриття аудиту якості

Персистентний облік системного аудиту (MASTER PROMPT 1 + 2). Мета — довести
**весь** продукт до єдиного стандарту якості під контролем, а не точково.
Цей файл продовжується між сесіями: перед роботою звір статуси тут, після
кожного модуля — онови рядок і додай PR.

## Легенда статусів
- **не перевірено** — модуль ще не проходив цілеспрямований аудит;
- **перевіряється** — аудит у процесі (відкритий PR/гілка);
- **перевірено** — пройдено аудит, змін не потребує (зафіксовано, чому);
- **потребує виправлення** — знайдено дефект, виправлення ще не змерджено;
- **виправлено** — виправлення змерджено;
- **повторно перевірено** — після виправлення повторно пройдено весь чек-лист.

## Вимір аудиту (для кожного модуля)
Функціонал/сценарії · UI/UX · дублювання/мертвий код · a11y (WCAG 2.2 AA) ·
адаптивність · продуктивність · безпечні покращення · тести/регресії.

### Три окремі підперевірки (обовʼязкова вимога)
Кожен модуль фіксуємо за **трьома** незалежними підперевірками:
- **Технічна** — код, типи, lint, автотести, dead-code/dedup, a11y на рівні розмітки.
- **Функціональна** — сценарії, стани помилок/порожні, навігація, resilience (читанням логіки + behavior-тести).
- **Візуальна** — фактичний рендер у браузері під роллю на desktop/tablet/mobile зі скриншотами.

Сторінка **не** позначається «повністю перевірено», доки всі три не зелені.

### ⚠️ Обмеження середовища — браузерна візуальна перевірка authed /staff/*
Станом на цю сесію **візуальна** перевірка `/staff/*` у браузері **недоступна** в
цьому виконавчому середовищі (підтверджено, не припущення):
- локальний dev (`npm run dev`, vite + @cloudflare/vite-plugin) **стартує**, але
  воркер віддає HTTP 500 на будь-якому маршруті — `worker/index.ts` читає
  `env.ASSETS.fetch`, а binding `ASSETS` у пісочниці не наповнений (навіть
  публічний storefront не рендериться локально);
- навіть після обходу цього, authed `/staff/*` потребує живого/засіяного D1
  (≈121 міграція + org + staff-акаунт + сесія в `staff_sessions`) і реальних
  записів у кількох станах, щоб рендер був репрезентативним.

**Розблокування:** або URL стейджингу з тестовим staff-логіном, або
credentials + засіяний бекенд. До того візуальні рядки `/staff/*` стоять
**незавершено**, а технічна/функціональна перевірки виконуються повноцінно
(читання коду + 333 behavior/regression-тести). Публічний сайт (`/`, `/ct`,
`/xray`, `/fluorography`, `/product`, `/privacy`) **можна** перевіряти в
браузері — коли черга дійде до них.

## Наскрізні (cross-cutting) інваріанти — застосовано до ВСЬОГО staff-контуру
Ці системні правки покривають **усі** staff-сторінки одразу, тож в окремих
рядках нижче вони не повторюються:
- **Клавіатурний фокус (WCAG 2.4.7)** — baseline `.workspaceShell :is(button,a[href],summary):focus-visible` (**#638**). Гард: `tests/staff-focus-ring-baseline.test.mjs`.
- **Оголошення завантаження (WCAG 4.1.3)** — усі `.dashLoading` мають `role="status"` (**#637**). Гард: `tests/staff-loading-status-role.test.mjs`.
- **DRY міток модальностей** — `EQUIPMENT_LABELS` у `lib/labels.ts` (**#639**). Гард: `tests/equipment-labels-dry.test.mjs`.
- **Канонічна дата** — `todayInKyiv()` замість browser-offset (**#641**, радіаційні модулі). Гард: `tests/radiation-date-canonical-kyiv.test.mjs`.
- **Резилієнс мутацій** — `catch`-обробка мережевих збоїв (хук `useSubmit` / явні catch) на опрацьованих сторінках; екрани доступу/мережі з «Повторити».

Гейт доставки: `npx tsc --noEmit` → `npm run lint` (0 errors) → `npm test`.

---

## Публічний сайт
| Маршрут | Статус | PR | Нотатки |
|---|---|---|---|
| `/` | перевірено | #623 | Focus-visible на плаваючому кошику; інше — ок |
| `/product` | не перевірено | — | |
| `/ct/[[...slug]]` | не перевірено | — | Контент-сторінки КТ |
| `/fluorography` | не перевірено | — | |
| `/xray` | не перевірено | — | |
| `/privacy` | не перевірено | — | Юридичний текст |

## Staff · операційний контур
| Маршрут | Статус | PR | Нотатки |
|---|---|---|---|
| `/staff/dashboard` | виправлено | #636 | Focus-ring десятків контролів, loading status |
| `/staff/board` | виправлено | #634 | Focus-ring канбану (0 :focus було), loading status |
| `/staff/intake` | виправлено | #635 | Фільтр ARIA, пошук aria-label, aria-current, focus |
| `/staff/studies` | виправлено | #631 | Focus-ring кнопок-фільтрів, loading status |
| `/staff/protocols` | виправлено | #632 | Повний focus-ring черги (спільний із patients) |
| `/staff/tasks` | повторно перевірено | #620,#621,#633 | Resilience + повний WAI-ARIA таб-патерн |
| `/staff/patients` | повторно перевірено | #630,#642 | Повний чек-лист: a11y (#630/#638), resilience (useSubmit), без мертвого коду й lint-warnings; `type="button"` на 2 поза-формних кнопках (#642). Нових дефектів не виявлено |
| `/staff/appointments` | потребує виправлення→виправлено | #643 | Тех ✅ + Функц ✅ (resilience, catch, екрани доступу/мережі; week-calendar day/week/list). Візуал ⛔ незавершено (authed browser недоступний). Виправлено: view-toggle/status-tabs `aria-pressed`+`role=group`, aria-label дати/пошуку, loading `role=status` |
| `/staff/imaging` | виправлено | #644 | Тех ✅ + Функц ✅ (useSubmit-резилієнс, catch, екрани доступу/мережі, PACS-банер, readonly fieldset). Візуал ⛔ незавершено. Виправлено неузгодженість: `protocolFilterTabs` приведено до `role=group`+`aria-pressed` (був неповний tablist) як на protocols; `aria-label` пошуку; `aria-current` вибраного; `role=status` на empty/loading |
| `/staff/chat` | виправлено | #646 | Тех ✅ + Функц ✅ (контакт-центр; сувора ідентифікація patient/legacy/shared-phone із reply-gating — клінічна безпека, не чіпано; resilience у load/open/reply). Візуал ⛔ незавершено. Виправлено: канальні фільтри `aria-pressed`, елементи списку `aria-current`, loading `role=status`, інпут відповіді `aria-label` |
| `/staff/critical-findings` | виправлено | #645 | Тех ✅ + Функц ✅ (act/load try/catch/finally, екран доступу + net-retry, actionError role=alert; потік flag→communicate→resolve із фіксацією ким/коли). Візуал ⛔ незавершено. Виправлено: loading `role=status`, `aria-label` на інпуті «як доведено» |
| `/staff/book` | виправлено | #647 | Тех ✅ + Функц ✅ (усі поля labelled через `<label><span>`, resilience loadRefs/submit, `todayInKyiv()` min, nearest-slot finder, контраст-алерт із CRM, category-filter послуг, deep-link prefill). Візуал ⛔ незавершено. Виправлено: DOB `max` 2100→`todayInKyiv()` (не допускає майбутню дату народження) |
| `/staff/patients/import` | не перевірено | — | CSV-імпорт |
| `/staff/patients/issues` | не перевірено | — | Аудит неузгодженостей |
| `/staff/protocols/corrections` | не перевірено | — | |

## Staff · BAS (фінанси / документи / склад)
| Маршрут | Статус | PR | Нотатки |
|---|---|---|---|
| `/staff/finance` | виправлено | #626 | Модельний ARIA-tabs; th aria-label |
| `/staff/documents` | виправлено | #629 | role=alert/status, th aria-label, aria-pressed, focus-ring table |
| `/staff/registers` | перевірено | — | Статична навігація; дефектів немає |
| `/staff/inventory` | виправлено | #627 | catch-резилієнс, th aria-label |
| `/staff/reports` | виправлено | #625 | Tablist ARIA, focus, loading status (#637) |
| `/staff/finance/services` | не перевірено | — | |
| `/staff/finance/print`, `/staff/finance/services/print` | не перевірено | — | Друковані форми |
| `/staff/counterparties` | виправлено | #648 | Тех ✅ + Функц ✅ (BAS master-detail; useSubmit-резилієнс, best-effort reload, canManage read-only, implicit-label форми, snapshot історичних назв). Візуал ⛔ незавершено. Виправлено: `financeLoading` `role=status`, `aria-label` пошуку, `aria-label="Дії"` порожньої колонки |
| `/staff/cash-accounts` | виправлено | #649 | Тех ✅ + Функц ✅ (BAS master-detail; useSubmit-резилієнс, best-effort reload, canEdit read-only, незмінна ідентичність — тип+валюта блокуються після створення, isDefault підтягує active). Візуал ⛔ незавершено. Виправлено: `financeLoading` `role=status`, `aria-label` пошуку, `aria-label="Дії"` порожньої колонки |
| `/staff/supplier-payables` | не перевірено | — | |
| `/staff/warehouses` | виправлено | #650 | Тех ✅ + Функц ✅ (BAS master-detail; useSubmit-резилієнс, best-effort reload, canEdit read-only, isDefault підтягує active, проведені документи зберігають історичний snapshot назви/коду). Візуал ⛔ незавершено. Виправлено: `financeLoading` `role=status`, `aria-label` пошуку, `aria-label="Дії"` порожньої колонки |
| `/staff/directories`, `/staff/directories/personnel-refs` | не перевірено | — | |
| `/staff/inventory/counts`, `/material-consumption`, `/transfers`, `/print` | не перевірено | — | Складські під-журнали |
| `/staff/reports/registers` | частково | #625 (h2) | Секційні h2; повного аудиту не було |
| `/staff/reports/receivables`, `/material-margin`, `/material-consumption-control` | частково | #625 (h2) | h2; повного аудиту не було |
| `/staff/reports/turnaround`, `/utilization`, `/seo` | не перевірено | — | `/seo` — робочий інструмент (лишено, #640) |

## Staff · персонал і радіаційна безпека
| Маршрут | Статус | PR | Нотатки |
|---|---|---|---|
| `/staff/personnel` | виправлено | #624 | scrollToEditor, row/table aria, th aria-label |
| `/staff/personnel/radiation-review-policy` | частково | #641 | Дата→Kyiv; повного аудиту не було |
| `/staff/personnel/radiation-compliance` | частково | #641 | Дата→Kyiv; повного аудиту не було |
| `/staff/personnel/radiation-review-queue` | частково | #641 | Дата→Kyiv; повного аудиту не було |
| `/staff/personnel/radiation-dose-summary` | частково | #641 | Дата→Kyiv; повного аудиту не було |
| `/staff/personnel/dosimetry`, `/vlk`, `/radiation-clearance`, `/radiation-training`, `/radiation-monitoring-scope` | не перевірено | — | Append-only реєстри |
| `/staff/personnel/print` | не перевірено | — | Друкована кадрова картка |

## Staff · адміністрування / налаштування / службові
| Маршрут | Статус | PR | Нотатки |
|---|---|---|---|
| `/staff/structure` | частково | #637 | loading status; повного аудиту не було |
| `/staff/profile` | частково | #637 | loading status; повного аудиту не було |
| `/staff/audit` | частково | #637 | loading status; повного аудиту не було |
| `/staff/organization` | частково | #637 | loading status; повного аудиту не було |
| `/staff/management` | не перевірено | — | Red-zones / summary (health monitor) |
| `/staff/settings` | не перевірено | — | Інтеграції, календар, месенджери |
| `/staff/services` | не перевірено | — | Кабінет→обладнання→послуги |
| `/staff/equipment` | не перевірено | — | |
| `/staff/maintenance` | не перевірено | — | ТО обладнання |
| `/staff/custom-fields` | не перевірено | — | |
| `/staff/tariffs` | не перевірено | — | |
| `/staff/site` | не перевірено | — | Контент публічного сайту |
| `/staff/shifts`, `/staff/schedule`, `/staff/work-calendar` | не перевірено | — | Графіки/зміни |
| `/staff/system/health`, `/staff/integrations/health`, `/staff/integrations/mwl` | не перевірено | — | Моніторинг/інтеграції |
| `/staff/whatsapp` | не перевірено | — | |
| `/staff/login`, `/activate`, `/forgot`, `/register` | не перевірено | — | Автентифікація (обережно — не чіпати потік авторизації без погодження) |
| `/staff` | не перевірено | — | Лендінг-хаб staff |

## API (125 маршрутів) — верхньорівневий статус
Окремі API-маршрути **цілеспрямовано не аудитовано** (крім дотичних змін у
сторінкових PR). За AGENTS.md контракти API, права доступу, схема БД і платежі
змінюються **лише після погодження**, тож тут аудит зосереджений на:
безпеці tenant-ізоляції, коректності станів, обробці помилок — **на рівні
читання**, без зміни контрактів. Детальний per-route облік — наступний етап.

| Група | К-сть | Статус | Нотатки |
|---|---|---|---|
| Публічні (`/availability`, `/catalog`, `/site-*`, `/patient-*`, `/my-*`, `/liqpay-callback`, `/pay-link`, `/tariffs`) | ~18 | не перевірено | Платіжні/публічні — зміни лише з погодженням |
| `/staff/*` операційні (`bookings`, `dashboard`, `studies`, `protocols*`, `result-deliveries`, `critical-findings`, `imaging*`) | ~20 | не перевірено | Покриті behavior-тестами; аудит читанням |
| `/staff/*` BAS (`finance`, `business-documents`, `inventory*`, `reports*`, `cash-accounts`, `counterparties`, `supplier-payables`, `service-deliveries*`) | ~25 | не перевірено | Immutable-реєстри; широке тестове покриття |
| `/staff/*` персонал/радіація (`personnel*`, `radiation-*`) | ~11 | не перевірено | Append-only; захищені тригерами |
| `/staff/*` адмін/налаштування/інтеграції (`settings*`, `org`, `members`, `2fa`, `search`, `whatsapp*`, `telegram*`, `external-calendar`) | ~25 | не перевірено | |
| Вебхуки (`/telegram/webhook`, `/whatsapp/webhook`) | 2 | не перевірено | Зовнішні — обережно |

> Примітка: проєкт має 333 тест-файли (значна частина — `*.behavior.test.mjs`
> з tenant-hardening і RBAC), тож базова коректність API вже під автотестами;
> цей аудит додає **цілеспрямований** read-only огляд поверх них.

---

## Журнал модулів (хронологія повних аудитів)
| Дата | Модуль | Результат | PR |
|---|---|---|---|
| 2026-10-12 | tasks | WAI-ARIA таби, resilience | #633 |
| 2026-10-12 | documents | a11y журналу + focus-ring таблиць | #629 |
| 2026-10-12 | patients | a11y CRM | #630 |
| 2026-10-12 | studies | focus-ring фільтрів | #631 |
| 2026-10-12 | protocols | focus-ring черги | #632 |
| 2026-10-12 | board | focus-ring канбану | #634 |
| 2026-10-12 | intake | a11y + focus-ring | #635 |
| 2026-10-12 | dashboard | focus-ring Пульта | #636 |
| 2026-10-12 | (наскрізне) loading status | #637; focus baseline #638; DRY labels #639; видалення sheet-preview #640; дати #641 | — |

## Наступні пріоритети (за ризиком/користю)
1. `/staff/appointments` — центральний календар, найбільше взаємодій, ще не аудитований.
2. `/staff/imaging` та `/staff/critical-findings` — клінічно важливі.
3. Радіаційні під-реєстри (`dosimetry`/`vlk`/`radiation-clearance`/`radiation-training`) — повний аудит поверх #641.
4. BAS-довідники (`counterparties`/`cash-accounts`/`warehouses`/`supplier-payables`).
