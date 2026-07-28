"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type StaffInfo = { email: string; displayName: string; role: string };
type Settings = { telegramConfigured: boolean; telegramChatId: string; payLink: string };

export default function StaffSettingsPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [chatId, setChatId] = useState("");
  const [payLink, setPayLink] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/staff/settings", { cache: "no-store" });
      if (res.status === 403) { if (active) setForbidden(true); return; }
      const data = await res.json().catch(() => ({})) as { settings?: Settings; staff?: StaffInfo };
      if (!active) return;
      if (data.settings) { setSettings(data.settings); setChatId(data.settings.telegramChatId); setPayLink(data.settings.payLink); }
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
        body: JSON.stringify({ telegramBotToken: token, telegramChatId: chatId, payLink }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; settings?: Settings };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти");
      if (data.settings) setSettings(data.settings);
      setToken("");
      setNotice("Налаштування збережено");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setStatus("idle");
    }
  }

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
      </section>

      <section className="settingsBlock">
        <h2>Оплата (ПриватБанк) для цивільних</h2>
        <p>Посилання на оплату (напр. кнопка/QR «Оплатити частинами» або checkout ПриватБанку). Його побачать цивільні пацієнти після заявки та в кабінеті.</p>
        <label><span>Посилання на оплату</span>
          <input value={payLink} onChange={(e) => setPayLink(e.target.value)} placeholder="https://…" autoComplete="off" inputMode="url" />
        </label>
      </section>

      {notice && <p className="notice success" role="status">{notice}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="button" disabled={status === "saving"}>{status === "saving" ? "Зберігаємо…" : "Зберегти налаштування"}</button>
    </form>
  );

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
