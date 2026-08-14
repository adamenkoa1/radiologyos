import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { interpretBotCommand, menuText, parseIncomingWebhook } from "../lib/whatsapp-bot.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("bot menu maps digits to actions and unknown text to human staff", () => {
  assert.equal(interpretBotCommand(""), "menu");
  assert.equal(interpretBotCommand("Меню"), "menu");
  assert.equal(interpretBotCommand("1"), "appointments");
  assert.equal(interpretBotCommand("2"), "booking");
  assert.equal(interpretBotCommand("3"), "info");
  assert.equal(interpretBotCommand("4"), "human");
  assert.equal(interpretBotCommand("боли в спине"), null); // не з меню → персонал
  assert.match(menuText(), /1 —/);
});

test("green-api incoming webhook parses text messages and rejects noise", () => {
  const ok = parseIncomingWebhook({
    typeWebhook: "incomingMessageReceived",
    idMessage: "ABC123",
    senderData: { chatId: "380971234567@c.us", senderName: "Іван" },
    messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "1" } },
  });
  assert.deepEqual(ok, { phoneNormalized: "380971234567", text: "1", idMessage: "ABC123", senderName: "Іван" });
  assert.equal(parseIncomingWebhook({ typeWebhook: "outgoingMessageStatus" }), null); // не вхідне
  assert.equal(parseIncomingWebhook({ typeWebhook: "incomingMessageReceived", senderData: { chatId: "not-a-phone@c.us" } }), null);
});

test("migration 0021 adds external_id and dedupes by unique index", async () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter(f => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const s of sql.split(/-->\s*statement-breakpoint/).map(x => x.trim()).filter(Boolean)) db.exec(s);
  }
  const cols = db.prepare("PRAGMA table_info(patient_communications)").all().map(c => c.name);
  assert.ok(cols.includes("external_id"));
  const ins = () => db.prepare("INSERT OR IGNORE INTO patient_communications (phone_normalized, channel, direction, summary, actor, external_id) VALUES (?,?,?,?,?,?)")
    .run("380971234567", "whatsapp", "inbound", "1", "patient", "MSG-1");
  assert.equal(ins().changes, 1); // перший запис
  assert.equal(ins().changes, 0); // повторний вебхук — ігнорується
});

test("whatsapp send is a guarded no-op until configured", async () => {
  const lib = await read("lib/whatsapp.ts");
  assert.match(lib, /WhatsApp не підключено/);
  assert.match(lib, /waInstance\$\{encodeURIComponent\(cfg\.idInstance\)\}\/sendMessage/);
  assert.match(lib, /@c\.us/);
});

test("webhook route is token-guarded (constant-time + header), deduped and rate-limited", async () => {
  const route = await read("app/api/whatsapp/webhook/route.ts");
  assert.match(route, /tokenMatches\(token, expected\)/); // звірка за сталий час
  assert.match(route, /crypto\.subtle\.digest\("SHA-256"/); // хеш-порівняння
  assert.match(route, /x-webhook-token/); // токен приймається із заголовка
  assert.match(route, /isRateLimited\(db, request, "whatsapp-webhook", 60, 15\)/); // нижча стеля
  assert.match(route, /INSERT OR IGNORE INTO patient_communications/);
  assert.match(route, /interpretBotCommand|botReply/);
});

test("staff whatsapp + contact-center routes are permission-guarded", async () => {
  const wa = await read("app/api/staff/whatsapp/route.ts");
  assert.match(wa, /requireOrgContext\(request, db\)/);
  assert.match(wa, /ctx\.role !== "admin"/);
  assert.doesNotMatch(wa, /requireStaff\(request, db\)/);
  assert.match(wa, /whatsapp_api_token_instance/);
  const chat = await read("app/api/staff/chat/route.ts");
  assert.match(chat, /canViewPatientRegistry\(member\.role\)/);
  assert.match(chat, /const CHANNELS = new Set\(\["whatsapp", "telegram", "sms", "email"\]\)/);
  assert.match(chat, /organization_id = \?/);
  assert.match(chat, /channel !== "whatsapp"/);
  assert.match(chat, /sendWhatsApp\(/);
});

test("whatsapp is wired as a reminder channel and into the nav", async () => {
  const notify = await read("lib/notify.ts");
  assert.match(notify, /channel: "whatsapp"/);
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/whatsapp"/);
  assert.match(shell, /href:"\/staff\/chat"/);
});