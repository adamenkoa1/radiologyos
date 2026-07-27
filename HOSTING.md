# Перенесення хостингу на власний Cloudflare

RadiologyOS збудований на Cloudflare Workers + D1, тож його можна розгорнути на
**вашому власному акаунті Cloudflare і домені**, повністю незалежно від платформи
OpenAI Sites (домен `*.chatgpt.site`). Нижче — покрокова інструкція.

> Файли для цього: `wrangler.cloudflare.toml` (конфіг), `scripts/deploy-cloudflare.sh`
> (деплой у один крок). Вони не чіпають наявний dev/build-процес.

## 0. Що знадобиться

- Акаунт **Cloudflare** (безкоштовного плану достатньо для старту; для оптимізації
  зображень `/_vinext/image` потрібен план із **Cloudflare Images**).
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
bash scripts/deploy-cloudflare.sh
```

Скрипт: збирає артефакт, застосовує всі міграції `drizzle/0000…0008` до вашої
віддаленої D1 і публікує Worker разом зі статикою. Після першого деплою Worker
буде доступний за адресою `https://radiologyos.<ваш-субдомен>.workers.dev`.

## 4. Власний домен

Домен **`radiologyos.tech`** уже прописаний у `wrangler.cloudflare.toml`
(апекс + `www`) як `custom_domain`. Оскільки його nameservers уже вказують на
Cloudflare, `wrangler deploy` **сам створить ці домени та TLS-сертифікати** —
жодних ручних дій у DNS не потрібно. Через кілька хвилин після деплою сайт буде
на `https://radiologyos.tech`.

`SITE_URL` у `lib/site.ts` уже налаштовано на `https://radiologyos.tech`
(використовується для метаданих, `sitemap.xml` і `robots.txt`). Якщо колись
зміните домен — оновіть його тут і в `routes` конфіга.

## 5. Перший вхід персоналу

Адміністратор і початковий пароль задані міграцією `0008`:

- **Email:** `adamenko.artem96@gmail.com`
- **Пароль:** `RadiologyOS!2026`

Увійдіть на `/staff/login` і **одразу змініть пароль** (сторінка `/staff` →
картка вашого профілю → «Новий пароль»). Там же додавайте інших працівників і
задавайте їм паролі.

## Повторні деплої

Просто запускайте `bash scripts/deploy-cloudflare.sh` — `wrangler d1 migrations
apply` застосовує лише нові міграції, деплой оновлює Worker і статику.

## Примітки

- **Images.** Якщо у плані немає Cloudflare Images, приберіть блок `[images]` у
  `wrangler.cloudflare.toml`. Оптимізатор зображень вимкнеться, решта працює.
- **Резервні копії.** Експорт D1: `npx wrangler d1 export DB --remote --output backup.sql`.
- **Секрети.** Застосунок не потребує зовнішніх ключів; уся авторизація —
  всередині (email + пароль, сесії в D1).
