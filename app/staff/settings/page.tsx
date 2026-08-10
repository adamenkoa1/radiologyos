"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type StaffInfo = { email: string; displayName: string; role: string };
type Settings = {
  telegramConfigured: boolean; telegramChatId: string; payLink: string;
  calendarConfigured: boolean; calendarToken?: string; externalIcsUrl: string;
  remindersEnabled: boolean; reminderLeadHours: string; smsGatewayUrl: string; smsGatewayAuthSet: boolean;
  emailGatewayUrl: string; emailGatewayAuthSet: boolean; emailGatewayFrom: string;
};

export default function StaffSettingsPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [chatId, setChatId] = useState("");
  const [payLink, setPayLink] = useState("");
  const [token, setToken] = useState("");
  const [externalIcsUrl, setExternalIcsUrl] = useState("");
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderLeadHours, setReminderLeadHours] = useState("3, 1");
  const [smsGatewayUrl, setSmsGatewayUrl] = useState("");
  const [smsGatewayAuth, setSmsGatewayAuth] = useState("");
  const [emailGatewayUrl, setEmailGatewayUrl] = useState("");
  const [emailGatewayAuth, setEmailGatewayAuth] = useState("");
  const [emailGatewayFrom, setEmailGatewayFrom] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [testing, setTesting] = useState(false);
  const [smsTestTo, setSmsTestTo] = useState("");
  const [emailTestTo, setEmailTestTo] = useState("");
  const [msgTesting, setMsgTesting] = useState<"" | "sms" | "email">("");
  const [calBusy, setCalBusy] = useState(false);
  const [calCopied, setCalCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/staff/settings", { cache: "no-store" });
      if (res.status === 403) { if (active) setForbidden(true); return; }
      const data = await res.json().catch(() => ({})) as { settings?: Settings; staff?: StaffInfo };
      if (!active) return;
      if (data.settings) {
        setSettings(data.settings); setChatId(data.settings.telegramChatId); setPayLink(data.settings.payLink); setExternalIcsUrl(data.settings.externalIcsUrl || "");
        setRemindersEnabled(Boolean(data.settings.remindersEnabled));
        setReminderLeadHours(data.settings.reminderLeadHours || "3, 1");
        setSmsGatewayUrl(data.settings.smsGatewayUrl || "");
        setEmailGatewayUrl(data.settings.emailGatewayUrl || "");
        setEmailGatewayFrom(data.settings.emailGatewayFrom || "");
      }
      if (data.staff) setStaff(data.staff);
    })();
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving"); setNotice(""); setError("");
    try {
      const res = await fetch("/api/staff/settings", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          telegramBotToken: token, telegramChatId: chatId, payLink, externalIcsUrl,
          remindersEnabled, reminderLeadHours, smsGatewayUrl, smsGatewayAuth, emailGatewayUrl, emailGatewayAuth, emailGatewayFrom,
        }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; settings?: Settings };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти");
      if (data.settings) setSettings(data.settings);
      setToken("");
      setSmsGatewayAuth("");
      setEmailGatewayAuth("");
      setNotice("Налаштування збережено");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setStatus("idle");
    }
  }

  async function generateCalendar() {
    setCalBusy(true); setNotice(""); setError("");
    try {
      const res = await fetch("/api/staff/settings/calendar", { method: "POST" });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; calendarToken?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося створити посилання");
      setSettings((prev) => (prev ? { ...prev, calendarConfigured: true, calendarToken: data.calendarToken || "" } : prev));
      setNotice("Посилання на календар оновлено");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося створити посилання");
    } finally {
      setCalBusy(false);
    }
  }

  async function sendMessagingTest(channel: "sms" | "email") {
    const to = (channel === "sms" ? smsTestTo : emailTestTo).trim();
    if (!to) { setError(channel === "sms" ? "Вкажіть номер для тесту" : "Вкажіть e-mail для тесту"); return; }
    setMsgTesting(channel); setNotice(""); setError("");
    try {
      const res = await fetch("/api/staff/settings/messaging-test", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, to }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося надіслати");
      setNotice(channel === "sms" ? "Тестове SMS надіслано" : "Тестовий e-mail надіслано");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося надіслати");
    } finally {
      setMsgTesting("");
    }
  }

  const calendarUrl = settings?.calendarToken && typeof window !== "undefined"
    ? `${window.location.origin}/api/calendar?token=${settings.calendarToken}`
    : "";

  const body = forbidden ? (
    <div className="accessDenied"><b>Доступ обмежено</b><p>Налаштування відділення доступні лише адміністратору.</p></div>
  ) : (
    <form className="settingsCard" onSubmit={save}>
      <section className="settingsBlock">
        <h2>Telegram-сповіщення реєстратурі</h2>
        <p>Бот надсилатиме повідомлення про кожну нову заявку в чат відділення. Створіть бота через <b>@BotFather</b>, додайте його в чат і вставте токен та ID чату.</p>
        <span className={`settingsState ${settings?.telegramConfigured ? "on" : "off"}`}>
          {settings?.telegramConfigured ? "✓ Увімкнено" : "Вимкнено"}
        </span>
        <label><span>Токен бота</span>
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder={settings?.telegramConfigured ? "Збережено — введіть, щоб змінити" : "123456:AA…"} autoComplete="off" />
          <small>Порожнє поле — лишити збережений токен. «-» — вимкнути сповіщення.</small>
        </label>
        <label><span>ID чату</span>
          <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890 або 123456789" autoComplete="off" />
        </label>
        <button type="button" className="button secondary" onClick={sendTest} disabled={testing || !settings?.telegramConfigured}>
          {testing ? "Надсилаємо…" : "Надіслати тестове повідомлення"}
        </button>
        {!settings?.telegramConfigured && <small className="settingsHint">Спершу збережіть токен і ID чату — тоді кнопку буде розблоковано.</small>}
      </section>

      <section className="settingsBlock">
        <h2>Оплата (ПриватБанк) для цивільних</h2>
        <p>Посилання на оплату (напр. кнопка/QR «Оплатити частинами» або сторінка оплати ПриватБанку). Його побачать цивільні пацієнти після заявки та в кабінеті.</p>
        <label><span>Посилання на оплату</span>
          <input value={payLink} onChange={(e) => setPayLink(e.target.value)} placeholder="https://…" autoComplete="off" inputMode="url" />
        </label>
      </section>

      <section className="settingsBlock">
        <h2>Google Календар (записи)</h2>
        <p>Приватне посилання-підписка: додайте його в Google Календар → «Інші календарі» → «Підписатися за URL». Підтверджені записи зʼявлятимуться в календарі й оновлюватимуться автоматично.</p>
        <span className={`settingsState ${settings?.calendarConfigured ? "on" : "off"}`}>
          {settings?.calendarConfigured ? "✓ Посилання створено" : "Не створено"}
        </span>
        {calendarUrl && (
          <label><span>Посилання для підписки</span>
            <input value={calendarUrl} readOnly onFocus={(e) => e.target.select()} />
            <small>
              <button type="button" className="linkBtn" onClick={async () => {
                try { await navigator.clipboard.writeText(calendarUrl); setCalCopied(true); setTimeout(() => setCalCopied(false), 1500); }
                catch { window.prompt("Скопіюйте посилання вручну:", calendarUrl); }
              }}>
                {calCopied ? "Скопійовано ✓" : "Копіювати посилання"}
              </button> · тримайте його в таємниці: воно відкриває службовий розклад.
            </small>
          </label>
        )}
        <button type="button" className="button secondary" onClick={generateCalendar} disabled={calBusy}>
          {calBusy ? "Оновлюємо…" : settings?.calendarConfigured ? "Оновити посилання" : "Створити посилання"}
        </button>
        {settings?.calendarConfigured && !calendarUrl && <small className="settingsHint">З міркувань безпеки повне посилання показується лише одразу після створення. Оновлення вимкне попередню підписку.</small>}
      </section>

      <section className="settingsBlock">
        <h2>Розклад із Google (у кабінеті)</h2>
        <p>Щоб персонал бачив події з вашого Google Календаря в пульті: у Google Календарі → «Налаштування календаря» → «Секретна адреса у форматі iCal» → скопіюйте й вставте сюди.</p>
        <label><span>Адреса календаря (iCal)</span>
          <input value={externalIcsUrl} onChange={(e) => setExternalIcsUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" autoComplete="off" inputMode="url" />
          <small>Порожнє поле вимикає показ. Найближчі події зʼявляться на «Пульті».</small>
        </label>
      </section>

      <section className="settingsBlock">
        <h2>Нагадування пацієнтам (SMS / e-mail)</h2>
        <p>Після <b>підтвердження</b> або <b>перенесення</b> запису пацієнту автоматично надсилається нагадування. SMS — на телефон із заявки, e-mail — якщо пацієнт вказав адресу. Кожне відправлення видно у черзі заявок.</p>
        <span className={`settingsState ${remindersEnabled ? "on" : "off"}`}>{remindersEnabled ? "✓ Увімкнено" : "Вимкнено"}</span>
        <label className="consent" style={{ margin: "6px 0 10px" }}>
          <input type="checkbox" checked={remindersEnabled} onChange={(e) => setRemindersEnabled(e.target.checked)} />
          <span>Надсилати пацієнтам автонагадування про підтвердження та перенесення запису</span>
        </label>
        <label><span>Нагадування за (годин до візиту)</span>
          <input value={reminderLeadHours} onChange={(e) => setReminderLeadHours(e.target.value)} placeholder="3, 1" inputMode="numeric" />
          <small>Через кому — за скільки годин до візиту слати нагадування (напр. «3, 1»). Працює, коли підключено WhatsApp і увімкнено нагадування вище. Розсилає планувальник кожні ~15 хв.</small>
        </label>
        <label><span>Адреса SMS-шлюзу (HTTP POST)</span>
          <input value={smsGatewayUrl} onChange={(e) => setSmsGatewayUrl(e.target.value)} placeholder="https://sms-провайдер/api/send" autoComplete="off" inputMode="url" />
          <small>Отримає JSON {"{ to, text }"}. Порожнє поле — SMS-канал вимкнено.</small>
        </label>
        <label><span>Авторизація SMS-шлюзу</span>
          <input value={smsGatewayAuth} onChange={(e) => setSmsGatewayAuth(e.target.value)} placeholder={settings?.smsGatewayAuthSet ? "Збережено — введіть, щоб змінити" : "Напр. Bearer <ключ>"} autoComplete="off" />
          <small>Значення заголовка Authorization. Порожнє — лишити збережене, «-» — очистити.</small>
        </label>
        <label><span>Перевірка SMS-шлюзу</span>
          <input value={smsTestTo} onChange={(e) => setSmsTestTo(e.target.value)} placeholder="+380 97 000 00 00" autoComplete="off" inputMode="tel" />
          <small>Введіть номер і натисніть «Тест», щоб надіслати пробне SMS через збережений шлюз.</small>
        </label>
        <button type="button" className="button secondary" onClick={() => sendMessagingTest("sms")} disabled={msgTesting === "sms" || !settings?.smsGatewayUrl}>
          {msgTesting === "sms" ? "Надсилаємо…" : "Тест SMS"}
        </button>
        {!settings?.smsGatewayUrl && <small className="settingsHint">Спершу збережіть адресу SMS-шлюзу — тоді кнопку буде розблоковано.</small>}
        <label><span>Адреса e-mail-шлюзу (HTTP POST)</span>
          <input value={emailGatewayUrl} onChange={(e) => setEmailGatewayUrl(e.target.value)} placeholder="https://email-провайдер/api/send" autoComplete="off" inputMode="url" />
          <small>Отримає JSON {"{ to, from, subject, text }"}. Порожнє поле — e-mail-канал вимкнено.</small>
        </label>
        <label><span>Авторизація e-mail-шлюзу</span>
          <input value={emailGatewayAuth} onChange={(e) => setEmailGatewayAuth(e.target.value)} placeholder={settings?.emailGatewayAuthSet ? "Збережено — введіть, щоб змінити" : "Напр. Bearer <ключ>"} autoComplete="off" />
          <small>Порожнє — лишити збережене, «-» — очистити.</small>
        </label>
        <label><span>Адреса відправника e-mail</span>
          <input value={emailGatewayFrom} onChange={(e) => setEmailGatewayFrom(e.target.value)} placeholder="noreply@likarnya.example" autoComplete="off" inputMode="email" />
        </label>
        <label><span>Перевірка e-mail-шлюзу</span>
          <input value={emailTestTo} onChange={(e) => setEmailTestTo(e.target.value)} placeholder="admin@likarnya.example" autoComplete="off" inputMode="email" />
          <small>Введіть адресу й натисніть «Тест», щоб надіслати пробний лист через збережений шлюз.</small>
        </label>
        <button type="button" className="button secondary" onClick={() => sendMessagingTest("email")} disabled={msgTesting === "email" || !settings?.emailGatewayUrl}>
          {msgTesting === "email" ? "Надсилаємо…" : "Тест e-mail"}
        </button>
        {!settings?.emailGatewayUrl && <small className="settingsHint">Спершу збережіть адресу e-mail-шлюзу — тоді кнопку буде розблоковано.</small>}
      </section>

      {notice && <p className="notice success" role="status">{notice}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="button" disabled={status === "saving"}>{status === "saving" ? "Зберігаємо…" : "Зберегти налаштування"}</button>
    </form>
  );

  async function sendTest() {
    setTesting(true); setNotice(""); setError("");
    try {
      const res = await fetch("/api/staff/settings/telegram-test", { method: "POST" });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося надіслати");
      setNotice("Тестове повідомлення надіслано — перевірте чат");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося надіслати");
    } finally {
      setTesting(false);
    }
  }

  return (
    <StaffWorkspaceShell
      active="settings"
      title="Налаштування відділення"
      description="Сповіщення реєстратурі та оплата — керує адміністратор."
      staffName={staff?.displayName}
      staffRole={staff?.role}
    >
      {body}
    </StaffWorkspaceShell>
  );
}
