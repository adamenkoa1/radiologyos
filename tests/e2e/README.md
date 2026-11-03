# E2E (авторизований браузер) для `/staff/protocols`

MASTER PROMPT 3, Этап F1. Раннер: `tests/e2e/protocol-scenarios.e2e.mjs`
(запуск — `npm run test:e2e`). **Не входить у `npm test`** і не є частиною
CI-гейту: unit-гейт бере лише `tests/*.test.mjs` (не рекурсивно), а це
`.e2e.mjs` у підтеці.

## Статус: локальний сценарій S7–S10 перевірений

Зібраний Worker працює локально з ASSETS і D1 через
`bash scripts/sites-env.sh -- npx --no-install wrangler dev --local --config wrangler.cloudflare.toml --port 8787`.
Старий висновок про відсутність bindings є історичним. Раннер без базового URL
або тестової авторизації **чесно пропускається** (`E2E SKIPPED`, exit 0);
це не PASS. При помилці кроку залежні дії не виконуються, exit status — 1.
Повна матриця клінічних сценаріїв F1/F2 ще не закрита.

## Як запустити (після усунення блокера)

Потрібен авторизований інстанс із реальними bindings (staging/preview або
локальний `wrangler dev --local` із засіяним D1). НЕ production, НЕ реальні дані
пацієнтів.

Варіант A — cookie наявної staff-сесії:

```
E2E_BASE_URL=https://<preview-host> \
E2E_STAFF_COOKIE="<session-cookie>" \
npm run test:e2e
```

Варіант B — логін через форму:

```
E2E_BASE_URL=https://<preview-host> \
E2E_STAFF_EMAIL=<test-staff> E2E_STAFF_PASSWORD=<test-pass> \
npm run test:e2e
```

Потрібні Playwright і сумісний Chromium. Драйвер може бути наданий середовищем
через Node module search path; змінювати manifests/lockfile для цього не потрібно.
Для встановленого системного браузера задайте
`E2E_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.

Рекомендовано задавати `E2E_BOOKING_ID` конкретного синтетичного дослідження,
призначеного тестовому радіологу. Без id раннер обирає лише заявку з маркером
`SYNTHETIC` або `TEST PILOT`; такий самий маркер обов'язковий у відкритому документі.
Канонічний production-host `radiologyos.tech` заборонено. Тест змінює й зберігає
чернетку: використовуйте лише ізольовані синтетичні записи, не дані пацієнтів.

Перевірки: збереження ручних правок у трьох режимах; права легеня/нижня частка/
S7–S10/−952 HU/модифікатори; узгоджений висновок без авто-«вродженого»;
збереження тексту й структурованої знахідки в D1 та повторне відкриття;
друкована форма з клінічним текстом без робочої навігації/перемикача режиму.
Кожен запуск має окрему папку `tests/e2e/artifacts/<timestamp>/` зі screenshot
і `results.json` з часом, результатами виконаних і кількістю пропущених кроків.
Cookie/пароль у звіт не записуються.
