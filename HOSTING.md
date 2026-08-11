# Перенесення хостингу на власний Cloudflare

RadiologyOS збудований на Cloudflare Workers + D1, тож його можна розгорнути на
**вашому власному акаунті Cloudflare і домені**, повністю незалежно від платформи
OpenAI Sites (домен `*.chatgpt.site`). Нижче — покрокова інструкція.

> Файли для цього: `wrangler.cloudflare.toml` (конфіг), `scripts/deploy-cloudflare.sh`
> (деплой у один крок). Вони не чіпають наявний dev/build-процес.

## 0. Що знадобиться

- Акаунт **Cloudflare** — **безкоштовного плану достатньо** (Workers + Static
  Assets + D1 + власний домен). Cloudflare Images (платний) не використовується.
- Node.js `>= 22.13` і встановлені залежності (`npm run install:ci`).
- (Опційно) власний домен, доданий у Cloudflare.

## 1. Вхід у Cloudflare

```bash
npx wrangler login
```

## 2. Створити базу D1

```bash
npx wrangler d1 create radiologyos
```

Скопіюйте `database_id` з виводу і вставте його у `wrangler.cloudflare.toml`
замість `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## 3. Розгортання (build + міграції + деплой)

```bash
RADIOLOGYOS_DEPLOY_CONFIRM=DEPLOY bash scripts/deploy-cloudflare.sh
```

Перед запуском перегляньте зміни та переконайтеся, що в `wrangler.cloudflare.toml`
вказана потрібна production-база. Скрипт збирає артефакт, виводить поточний D1
Time Travel bookmark для відновлення, застосовує всі ще не виконані міграції й
публікує Worker разом зі статикою.

## 4. Власний домен

Домен **`radiologyos.tech`** уже прописаний у `wrangler.cloudflare.toml`
(апекс + `www`) як `custom_domain`. Оскільки його nameservers уже вказують на
Cloudflare, `wrangler deploy` **сам створить ці домени та TLS-сертифікати** —
жодних ручних дій у DNS не потрібно. Через кілька хвилин після деплою сайт буде
на `https://radiologyos.tech`.

`SITE_URL` у `lib/site.ts` уже налаштовано на `https://radiologyos.tech`
(використовується для метаданих, `sitemap.xml` і `robots.txt`). Якщо колись
зміните домен — оновіть його тут і в `routes` конфіга.

## 5. Перший адміністратор

Міграції навмисно не створюють активний обліковий запис зі стандартним паролем.
Першого адміністратора має створити власник Cloudflare-акаунта безпосередньо в
D1. Не додавайте пароль, його хеш або тимчасовий SQL-файл до Git.

Згенеруйте PBKDF2-хеш локально; введений пароль не потрапляє до історії shell:

```bash
read -rsp "Новий пароль адміністратора: " RADIOLOGYOS_BOOTSTRAP_PASSWORD
export RADIOLOGYOS_BOOTSTRAP_PASSWORD
node scripts/hash-password.mjs
unset RADIOLOGYOS_BOOTSTRAP_PASSWORD
```

У Cloudflare D1 Console виконайте `INSERT ... ON CONFLICT DO UPDATE` для таблиці
`staff_members`, вказавши робочий email, ім’я, роль `admin`, `active = 1` і
отриманий `password_hash`. Після входу на `/staff/login` створюйте інших
працівників лише через сторінку `/staff`.

## 6. Дозволені зовнішні хости

PACS та зовнішній ICS-календар працюють через fail-closed політику вихідних
з’єднань. Якщо `OUTBOUND_ALLOWED_HOSTS` відсутній або порожній, RadiologyOS не
виконуватиме запити до змінних зовнішніх URL. Перед увімкненням такої інтеграції
явно задайте точні hostname через кому, без схеми та шляхів, наприклад:

```bash
printf '%s' 'pacs.example.org,calendar.example.org' | \
  npx wrangler secret put OUTBOUND_ALLOWED_HOSTS --config wrangler.cloudflare.toml
```

Додавайте лише реально потрібні hostname. Піддомени не дозволяються автоматично:
`pacs.example.org` не відкриває доступ до `other.pacs.example.org`. Telegram і
поточний Green API використовують власні фіксовані transport-hosts і не залежать
від цього списку.

## Повторні деплої

Рекомендований шлях — ручний workflow **Deploy to Cloudflare** у GitHub Actions:
він вимагає явного вибору `DEPLOY` та Environment `production`. Для локального
запуску знову використовуйте підтвердження з розділу 3. `wrangler d1 migrations
apply` застосує лише нові міграції.

## Примітки

- **Images.** Якщо у плані немає Cloudflare Images, приберіть блок `[images]` у
  `wrangler.cloudflare.toml`. Оптимізатор зображень вимкнеться, решта працює.
- **Відновлення.** D1 Time Travel увімкнено на стороні Cloudflare. Збережіть
  bookmark, який друкується перед міграціями, у захищеному журналі операції.
- **Експорт.** Якщо політика установи дозволяє SQL-експорт, зберігайте його лише
  у зашифрованому сховищі з обмеженим доступом; не завантажуйте дамп як
  загальнодоступний CI-артефакт.
- **Секрети.** Telegram, SMS та e-mail токени зберігайте як Cloudflare secrets
  або в іншому погодженому сховищі, а не у Git.
- **Вихідні з’єднання.** Для змінних інтеграцій діє лише явний список
  `OUTBOUND_ALLOWED_HOSTS`; порожній список блокує всі такі запити.
