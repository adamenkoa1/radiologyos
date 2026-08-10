import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("migration adds patient telegram_chat_id and link-token table", async () => {
  const sql = await read("drizzle/0025_patient_telegram.sql");
  assert.match(sql, /ALTER TABLE `patient_profiles` ADD COLUMN `telegram_chat_id`/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `telegram_link_tokens`/);
  assert.match(sql, /`token_hash` text PRIMARY KEY/);
  assert.match(sql, /`expires_at` text NOT NULL/);
});

test("link lib: single-use hashed tokens + /start webhook handler", async () => {
  const lib = await read("lib/telegram-link.ts");
  assert.match(lib, /export async function createTelegramLinkToken/);
  assert.match(lib, /export async function consumeTelegramLinkToken/);
  assert.match(lib, /export async function linkPatientTelegram/);
  assert.match(lib, /export async function handleTelegramUpdate/);
  // Токен зберігається лише як хеш.
  assert.match(lib, /hashToken\(/);
  assert.match(lib, /DELETE FROM telegram_link_tokens WHERE token_hash = \?/); // одноразовість
  // /start <token> прив'язує chat_id; /stop відписує.
  assert.match(lib, /\/\^\\\/start\\s\+\(\[a-f0-9\]\{64\}\)\$\//);
  assert.match(lib, /\/stop\\b/);
  assert.match(lib, /ON CONFLICT\(phone_normalized\) DO UPDATE SET telegram_chat_id/);
});

test("patient link endpoint needs a verified session and returns a t.me deep link", async () => {
  const route = await read("app/api/my-telegram-link/route.ts");
  assert.match(route, /requirePatientSession\(/);
  assert.match(route, /createTelegramLinkToken\(db, session\.phoneNormalized\)/);
  assert.match(route, /https:\/\/t\.me\/\$\{username\}\?start=\$\{token\}/);
  assert.match(route, /isRateLimited\(/);
});

test("public webhook is protected by the secret header set on setWebhook", async () => {
  const route = await read("app/api/telegram/webhook/route.ts");
  assert.match(route, /x-telegram-bot-api-secret-token/);
  assert.match(route, /provided !== secret/);
  assert.match(route, /status: 401/);
  assert.match(route, /handleTelegramUpdate\(/);
});

test("admin enable endpoint registers the webhook with a stored secret", async () => {
  const route = await read("app/api/staff/settings/telegram-webhook/route.ts");
  assert.match(route, /member\.role !== "admin"/);
  assert.match(route, /setTelegramWebhook\(db, webhookUrl, secret\)/);
  assert.match(route, /\/api\/telegram\/webhook/);
  assert.match(route, /setSetting\(db, "telegram_webhook_secret"/);
});

test("telegram lib can message an arbitrary chat and register a webhook", async () => {
  const lib = await read("lib/telegram.ts");
  assert.match(lib, /export async function sendTelegramTo/);
  assert.match(lib, /export async function telegramBotUsername/);
  assert.match(lib, /export async function setTelegramWebhook/);
  assert.match(lib, /getMe/);
  assert.match(lib, /secret_token: secret/);
});

test("notify sends via Telegram when a patient linked their chat", async () => {
  const notify = await read("lib/notify.ts");
  assert.match(notify, /import \{ sendTelegramTo \} from ".\/telegram"/);
  assert.match(notify, /telegram_chat_id AS tg/);
  // Telegram-канал у обох шляхах (авто-нагадування і разове повідомлення).
  const pushes = notify.match(/channel: "telegram"/g) || [];
  assert.ok(pushes.length >= 2, "очікуємо Telegram-канал у reminder і message");
  assert.match(notify, /sendTelegramTo\(db, telegramChatId, body\)/);
});

test("cabinet offers a Telegram connect button that calls the link endpoint", async () => {
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /id="tgConnectBtn"/);
  assert.match(cabinet, /\/api\/my-telegram-link/);
  assert.match(cabinet, /function connectTelegram/);
});

test("settings page can enable the patient Telegram channel", async () => {
  const page = await read("app/staff/settings/page.tsx");
  assert.match(page, /telegram-webhook/);
  assert.match(page, /enablePatientTelegram/);
  assert.match(page, /Увімкнути Telegram для пацієнтів/);
});
