# E2E (авторизований браузер) для `/staff/protocols`

MASTER PROMPT 3, Этап F1. Раннер: `tests/e2e/protocol-scenarios.e2e.mjs`
(запуск — `npm run test:e2e`). **Не входить у `npm test`** і не є частиною
CI-гейту: unit-гейт бере лише `tests/*.test.mjs` (не рекурсивно), а це
`.e2e.mjs` у підтеці.

## Статус: BLOCKED у sandbox

У цьому середовищі немає локального Cloudflare-рантайму з bindings, тож
`/staff/*` не рендериться локально (деталі й докази — у
`docs/protocol-builder-master-audit.md`). Раннер без середовища **чесно
пропускається** (`E2E SKIPPED — F1 BLOCKED`, exit 0).

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

Потрібен модуль Playwright (`npm i -D playwright`); бінарник Chromium у
середовищі вже є (`PLAYWRIGHT_BROWSERS_PATH`). Скриншоти — у
`tests/e2e/artifacts/`. На першому авторизованому запуску підтвердьте/уточніть
селектори (вони спираються на українські рядки з `app/staff/protocols/page.tsx`).
