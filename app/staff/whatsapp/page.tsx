"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type StaffInfo = { email: string; displayName: string; role: string };
type Settings = { idInstance: string; apiTokenSet: boolean; enabled: boolean; connected: boolean; webhookUrl: string };

export default function StaffWhatsAppPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [idInstance, setIdInstance] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "testing">("idle");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/staff/whatsapp", { cache: "no-store" });
      if (res.status === 403) { if (active) setForbidden(true); return; }
      const data = await res.json().catch(() => ({})) as { settings?: Settings; staff?: StaffInfo };
      if (!active) return;
      if (data.settings) { setSettings(data.settings); setIdInstance(data.settings.idInstance); setEnabled(data.settings.enabled); }
      if (data.staff) setStaff(data.staff);
    })();
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving"); setNotice(""); setError("");
    try {
      const res = await fetch("/api/staff/whatsapp", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ idInstance, apiToken, enabled }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; settings?: Settings; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти");
      if (data.settings) { setSettings(data.settings); setApiToken(""); }
      setNotice("Збережено.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зберегти"); }
    finally { setStatus("idle"); }
  }

  async function sendTest() {
    setStatus("testing"); setNotice(""); setError("");
    try {
      const res = await fetch("/api/staff/whatsapp/test", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: testPhone }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося надіслати");
      setNotice("Тестове повідомлення надіслано ✅");
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося надіслати"); }
    finally { setStatus("idle"); }
  }

  const body = forbidden
    ? <p className="notice error" role="alert">WhatsApp налаштовує лише адміністратор.</p>
    : !settings
      ? <p className="notice">Завантаження…</p>
      : <div className="settingsCard">
          <section className="settingsBlock">
            <span className={`settingsState ${settings.connected ? "on" : "off"}`}>{settings.connected ? "Підключено" : "Не підключено"}</span>
            <h3>Як підключити</h3>
            <ol className="waSteps">
              <li>Зареєструйтеся на <b>green-api.com</b> — це сервіс, через який WhatsApp з’єднується з програмами.</li>
              <li>Натисніть «Створити інстанс» і відскануйте QR-код робочим WhatsApp клініки (як у WhatsApp Web).</li>
              <li>Скопіюйте звідти <b>idInstance</b> (число) і <b>apiTokenInstance</b> (довгий код) у поля нижче.</li>
              <li>Впишіть URL вебхука (нижче) у налаштуваннях інстансу green-api — щоб вхідні повідомлення надходили в чат.</li>
            </ol>
          </section>

          <form className="settingsBlock" onSubmit={save}>
            <h3>Ключі green-api</h3>
            <label><span>idInstance (число)</span><input value={idInstance} onChange={e => setIdInstance(e.target.value)} placeholder="напр. 1101000001" /></label>
            <label><span>apiTokenInstance (код)</span><input type="password" value={apiToken} onChange={e => setApiToken(e.target.value)} placeholder={settings.apiTokenSet ? "•••••••• (збережено)" : "Довгий код із green-api"} autoComplete="off" /><small>Порожньо — лишити збережений; «-» — очистити.</small></label>
            <label className="crmCheck"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /><span>Надсилати пацієнтам підтвердження/нагадування у WhatsApp</span></label>
            {notice && <p className="notice success" role="status">{notice}</p>}
            {error && <p className="notice error" role="alert">{error}</p>}
            <button className="button" type="submit" disabled={status === "saving"}>{status === "saving" ? "Зберігаємо…" : "Підключити WhatsApp"}</button>
          </form>

          <section className="settingsBlock">
            <h3>URL вебхука (впишіть у green-api)</h3>
            <label><span>Webhook URL</span><input readOnly value={settings.webhookUrl} onFocus={e => e.target.select()} /></label>
            <button type="button" className="button secondary" onClick={() => { void navigator.clipboard?.writeText(settings.webhookUrl); setCopied(true); }}>{copied ? "Скопійовано ✓" : "Скопіювати URL"}</button>
          </section>

          <section className="settingsBlock">
            <h3>Тест</h3>
            <label><span>Номер для тесту</span><input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="+380 97 000 00 00" /></label>
            <button type="button" className="button secondary" onClick={() => void sendTest()} disabled={status === "testing" || !settings.connected}>{status === "testing" ? "Надсилаємо…" : "Надіслати тест"}</button>
          </section>

          <section className="settingsBlock">
            <h3>Що вміє бот</h3>
            <p className="settingsHint">Пацієнт надсилає цифру — бот відповідає:</p>
            <ul className="waBotList">
              <li>1 — показати найближчі записи</li>
              <li>2 — як записатися на дослідження</li>
              <li>3 — адреса, години роботи та ціни</li>
              <li>4 — передати звернення адміністратору</li>
            </ul>
            <p className="settingsHint">Будь-який інший текст потрапляє в розділ «Чат з пацієнтами» — відповідаєте вручну.</p>
          </section>
        </div>;

  return (
    <StaffWorkspaceShell active="whatsapp" title="WhatsApp" description="Підключення номера, автонагадування та бот — керує адміністратор." staffName={staff?.displayName} staffRole={staff?.role}>
      {body}
    </StaffWorkspaceShell>
  );
}
