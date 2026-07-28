"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type StaffInfo = { email: string; displayName: string; role: string };
type Settings = { telegramConfigured: boolean; telegramChatId: string; payLink: string; registrationCodeSet: boolean; calendarToken: string; externalIcsUrl: string };

export default function StaffSettingsPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [chatId, setChatId] = useState("");
  const [payLink, setPayLink] = useState("");
  const [token, setToken] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [externalIcsUrl, setExternalIcsUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [testing, setTesting] = useState(false);
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
      if (data.settings) { setSettings(data.settings); setChatId(data.settings.telegramChatId); setPayLink(data.settings.payLink); setExternalIcsUrl(data.settings.externalIcsUrl || ""); }
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
        body: JSON.stringify({ telegramBotToken: token, telegramChatId: chatId, payLink, accessCode, externalIcsUrl }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; settings?: Settings };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти");
      if (data.settings) setSettings(data.settings);
      setToken("");
      setAccessCode("");
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
      setSettings((prev) => (prev ? { ...prev, calendarToken: data.calendarToken || "" } : prev));
      setNotice("Посилання на календар оновлено");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося створити посилання");
    } finally {
      setCalBusy(false);
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
        <h2>Код доступу для реєстрації персоналу</h2>
        <p>Потрібен, щоб зареєструватися чи відновити пароль на сторінках <b>/staff/register</b> та <b>/staff/forgot</b>. Змініть стандартний код на власний і повідомте його лише працівникам.</p>
        <span className={`settingsState ${settings?.registrationCodeSet ? "on" : "off"}`}>
          {settings?.registrationCodeSet ? "✓ Код встановлено" : "Не встановлено"}
        </span>
        <label><span>Новий код доступу</span>
          <input value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Залиште порожнім, щоб не змінювати" autoComplete="off" minLength={6} />
          <small>Мінімум 6 символів. Зберігається лише у вигляді хешу.</small>
        </label>
      </section>

      <section className="settingsBlock">
        <h2>Оплата (ПриватБанк) для цивільних</h2>
        <p>Посилання на оплату (напр. кнопка/QR «Оплатити частинами» або checkout ПриватБанку). Його побачать цивільні пацієнти після заявки та в кабінеті.</p>
        <label><span>Посилання на оплату</span>
          <input value={payLink} onChange={(e) => setPayLink(e.target.value)} placeholder="https://…" autoComplete="off" inputMode="url" />
        </label>
      </section>

      <section className="settingsBlock">
        <h2>Google Календар (записи)</h2>
        <p>Приватне посилання-підписка: додайте його в Google Календар → «Інші календарі» → «Підписатися за URL». Підтверджені записи зʼявлятимуться в календарі й оновлюватимуться автоматично.</p>
        <span className={`settingsState ${settings?.calendarToken ? "on" : "off"}`}>
          {settings?.calendarToken ? "✓ Посилання створено" : "Не створено"}
        </span>
        {calendarUrl && (
          <label><span>Посилання для підписки</span>
            <input value={calendarUrl} readOnly onFocus={(e) => e.target.select()} />
            <small>
              <button type="button" className="linkBtn" onClick={() => { navigator.clipboard?.writeText(calendarUrl); setCalCopied(true); setTimeout(() => setCalCopied(false), 1500); }}>
                {calCopied ? "Скопійовано ✓" : "Копіювати посилання"}
              </button> · тримайте його в таємниці — воно містить дані пацієнтів.
            </small>
          </label>
        )}
        <button type="button" className="button secondary" onClick={generateCalendar} disabled={calBusy}>
          {calBusy ? "Оновлюємо…" : settings?.calendarToken ? "Оновити посилання" : "Створити посилання"}
        </button>
        {settings?.calendarToken && <small className="settingsHint">Оновлення посилання вимкне попереднє (стару підписку доведеться додати заново).</small>}
      </section>

      <section className="settingsBlock">
        <h2>Розклад із Google (у кабінеті)</h2>
        <p>Щоб персонал бачив події з вашого Google Календаря в пульті: у Google Календарі → «Налаштування календаря» → «Секретна адреса у форматі iCal» → скопіюйте й вставте сюди.</p>
        <label><span>Адреса календаря (iCal)</span>
          <input value={externalIcsUrl} onChange={(e) => setExternalIcsUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" autoComplete="off" inputMode="url" />
          <small>Порожнє поле вимикає показ. Найближчі події зʼявляться на «Пульті».</small>
        </label>
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
