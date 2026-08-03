"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { roleLabelUk } from "../../../lib/labels";

type StaffInfo = { email: string; displayName: string; role: string };
type Conversation = { phone: string; name: string; lastText: string; lastDirection: string; lastAt: string };
type Message = { id?: number; direction: string; text: string; actor: string; createdAt: string };

function displayPhone(phone: string) {
  return /^380\d{9}$/.test(phone) ? `+${phone.slice(0, 3)} ${phone.slice(3, 5)} ${phone.slice(5, 8)} ${phone.slice(8, 10)} ${phone.slice(10)}` : phone;
}
function shortTime(value: string) {
  const d = new Date((value || "").replace(" ", "T") + (value && !value.includes("Z") ? "Z" : ""));
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

export default function StaffChatPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [activeName, setActiveName] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadConversations() {
    const res = await fetch("/api/staff/chat", { cache: "no-store" });
    if (res.status === 403) { setForbidden(true); return; }
    const data = await res.json().catch(() => ({})) as { conversations?: Conversation[]; staff?: StaffInfo };
    setConversations(data.conversations || []);
    if (data.staff) setStaff(data.staff);
    setLoaded(true);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadConversations(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function openConversation(phone: string) {
    // Скидаємо чернетку — щоб текст для одного пацієнта не пішов іншому.
    setActive(phone); setError(""); setMessages([]); setDraft(""); setThreadLoading(true);
    try {
      const res = await fetch(`/api/staff/chat?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as { messages?: Message[]; name?: string };
      setMessages(data.messages || []);
      setActiveName(data.name || "");
    } catch {
      setError("Не вдалося завантажити діалог — перевірте зʼєднання");
    } finally {
      setThreadLoading(false);
    }
  }

  async function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !draft.trim()) return;
    setSending(true); setError("");
    const text = draft.trim();
    const res = await fetch("/api/staff/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: active, text }),
    });
    const data = await res.json().catch(() => ({})) as { ok?: boolean; message?: Message; error?: string };
    setSending(false);
    if (!res.ok || !data.ok) { setError(data.error || "Не вдалося надіслати"); return; }
    setDraft("");
    if (data.message) setMessages(m => [...m, data.message as Message]);
    void loadConversations();
  }

  const body = forbidden
    ? <p className="notice error" role="alert">Чат доступний реєстратору або адміністратору.</p>
    : <div className="chatShell">
        <aside className="chatList">
          {!loaded ? <p className="empty">Завантаження…</p>
            : conversations.length === 0 ? <p className="empty">Поки немає повідомлень. Тут з’явиться листування, коли пацієнт напише у WhatsApp клініки.</p>
              : conversations.map(c => (
                <button key={c.phone} className={`chatListItem${active === c.phone ? " active" : ""}`} onClick={() => void openConversation(c.phone)}>
                  <b>{c.name || displayPhone(c.phone)}</b>
                  <small>{c.lastDirection === "inbound" ? "" : "Ви: "}{c.lastText}</small>
                  <span className="chatListTime">{shortTime(c.lastAt)}</span>
                </button>
              ))}
        </aside>
        <section className="chatThread">
          {!active ? <div className="chatEmpty"><span aria-hidden="true">💬</span><p>Оберіть діалог зліва</p></div>
            : <>
                <header className="chatThreadHead"><b>{activeName || displayPhone(active)}</b><small>{displayPhone(active)}</small></header>
                <div className="chatMessages">
                  {messages.map((m, i) => (
                    <div key={m.id ?? i} className={`chatMsg ${m.direction === "inbound" ? "in" : "out"}`}>
                      <p>{m.text}</p>
                      <span>{m.direction === "inbound" ? "" : m.actor === "bot" ? "Бот · " : ""}{shortTime(m.createdAt)}</span>
                    </div>
                  ))}
                  {messages.length === 0 && <p className="empty">{threadLoading ? "Завантаження…" : "Повідомлень ще немає."}</p>}
                </div>
                {error && <p className="notice error" role="alert">{error}</p>}
                <form className="chatReply" onSubmit={reply}>
                  <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ваша відповідь…" />
                  <button type="submit" disabled={sending || !draft.trim()}>{sending ? "…" : "Надіслати"}</button>
                </form>
              </>}
        </section>
      </div>;

  return (
    <StaffWorkspaceShell active="chat" title="Чат з пацієнтами" description="WhatsApp-листування — відповідайте прямо звідси." staffName={staff?.displayName} staffRole={roleLabelUk(staff?.role)}>
      {body}
    </StaffWorkspaceShell>
  );
}
