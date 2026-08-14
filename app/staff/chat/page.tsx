"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { roleLabelUk } from "../../../lib/labels";

type StaffInfo = { email: string; displayName: string; role: string };
type Channel = "whatsapp" | "telegram" | "sms" | "email";
type Conversation = {
  phone: string; name: string; lastText: string; lastDirection: string;
  lastChannel: Channel; lastAt: string; issueCount: number;
};
type Message = { id?: number; channel: Channel; direction: string; text: string; actor: string; createdAt: string };
type DeliveryIssue = { id: number; channel: Channel; kind: string; status: string; error: string; createdAt: string; bookingId: number };
type ChannelStat = { channel: Channel; count: number };

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp", telegram: "Telegram", sms: "SMS", email: "E-mail",
};

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
  const [channelStats, setChannelStats] = useState<ChannelStat[]>([]);
  const [failedDeliveries, setFailedDeliveries] = useState(0);
  const [channel, setChannel] = useState("all");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [activeName, setActiveName] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [issues, setIssues] = useState<DeliveryIssue[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadConversations(nextChannel = channel) {
    const suffix = nextChannel === "all" ? "" : `?channel=${encodeURIComponent(nextChannel)}`;
    const res = await fetch(`/api/staff/chat${suffix}`, { cache: "no-store" });
    if (res.status === 403) { setForbidden(true); return; }
    const data = await res.json().catch(() => ({})) as {
      conversations?: Conversation[]; staff?: StaffInfo; channelStats?: ChannelStat[]; failedDeliveries?: number;
    };
    setConversations(data.conversations || []);
    setChannelStats(data.channelStats || []);
    setFailedDeliveries(Number(data.failedDeliveries || 0));
    if (data.staff) setStaff(data.staff);
    setLoaded(true);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadConversations("all"); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function changeChannel(next: string) {
    setChannel(next); setActive(null); setMessages([]); setIssues([]); setLoaded(false);
    await loadConversations(next);
  }

  async function openConversation(phone: string) {
    setActive(phone); setError(""); setMessages([]); setIssues([]); setDraft(""); setThreadLoading(true);
    try {
      const filter = channel === "all" ? "" : `&channel=${encodeURIComponent(channel)}`;
      const res = await fetch(`/api/staff/chat?phone=${encodeURIComponent(phone)}${filter}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as { messages?: Message[]; name?: string; issues?: DeliveryIssue[] };
      setMessages(data.messages || []);
      setIssues(data.issues || []);
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
      body: JSON.stringify({ phone: active, text, channel: "whatsapp" }),
    });
    const data = await res.json().catch(() => ({})) as { ok?: boolean; message?: Message; error?: string };
    setSending(false);
    if (!res.ok || !data.ok) { setError(data.error || "Не вдалося надіслати"); return; }
    setDraft("");
    if (data.message) setMessages(m => [...m, data.message as Message]);
    void loadConversations(channel);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(c => `${c.name} ${c.phone} ${c.lastText}`.toLowerCase().includes(q));
  }, [conversations, query]);

  const stat = (name: string) => Number(channelStats.find(s => s.channel === name)?.count || 0);

  const body = forbidden
    ? <p className="notice error" role="alert">Контакт-центр доступний реєстратору або адміністратору.</p>
    : <div className="contactCenter">
        <section className="contactKpis" aria-label="Комунікації за каналами">
          <article><small>Діалоги</small><b>{conversations.length}</b><span>у поточному фільтрі</span></article>
          <article><small>WhatsApp</small><b>{stat("whatsapp")}</b><span>подій у журналі</span></article>
          <article><small>Telegram</small><b>{stat("telegram")}</b><span>подій у журналі</span></article>
          <article className={failedDeliveries ? "warn" : ""}><small>Помилки доставки</small><b>{failedDeliveries}</b><span>потребують уваги</span></article>
        </section>

        <div className="contactToolbar">
          <div className="contactFilters" role="group" aria-label="Канал">
            {["all", "whatsapp", "telegram", "sms", "email"].map(value => (
              <button key={value} className={channel === value ? "active" : ""} onClick={() => void changeChannel(value)}>
                {value === "all" ? "Усі" : CHANNEL_LABEL[value]}
              </button>
            ))}
          </div>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Пошук: ПІБ, телефон, текст" aria-label="Пошук у контакт-центрі" />
        </div>

        <div className="chatShell contactShell">
          <aside className="chatList">
            {!loaded ? <p className="empty">Завантаження…</p>
              : filtered.length === 0 ? <p className="empty">Немає комунікацій у цьому фільтрі.</p>
                : filtered.map(c => (
                  <button key={c.phone} className={`chatListItem${active === c.phone ? " active" : ""}`} onClick={() => void openConversation(c.phone)}>
                    <span className={`channelDot ${c.lastChannel}`} aria-hidden="true" />
                    <b>{c.name || displayPhone(c.phone)}</b>
                    <small>{c.lastDirection === "inbound" ? "" : "Вихідне · "}{c.lastText}</small>
                    <span className="chatListMeta">{CHANNEL_LABEL[c.lastChannel] || c.lastChannel} · {shortTime(c.lastAt)}</span>
                    {Number(c.issueCount || 0) > 0 && <span className="issueBadge">{c.issueCount}</span>}
                  </button>
                ))}
          </aside>

          <section className="chatThread">
            {!active ? <div className="chatEmpty"><span className="contactEmptyIcon" aria-hidden="true" /><p>Оберіть пацієнта зліва</p><small>Історія WhatsApp, Telegram, SMS та e-mail в одному місці.</small></div>
              : <>
                  <header className="chatThreadHead">
                    <div><b>{activeName || displayPhone(active)}</b><small>{displayPhone(active)}</small></div>
                    <span className="contactReplyHint">Відповідь: WhatsApp</span>
                  </header>
                  {issues.length > 0 && <div className="deliveryIssues" role="status">
                    <b>Не доставлено: {issues.length}</b>
                    <span>{issues[0]?.error || "Перевірте налаштування каналу"}</span>
                  </div>}
                  <div className="chatMessages">
                    {messages.map((m, i) => (
                      <div key={m.id ?? i} className={`chatMsg ${m.direction === "inbound" ? "in" : "out"}`}>
                        <div className="messageChannel">{CHANNEL_LABEL[m.channel] || m.channel}</div>
                        <p>{m.text}</p>
                        <span>{m.direction === "inbound" ? "Пацієнт" : m.actor === "system" ? "Система" : "Персонал"} · {shortTime(m.createdAt)}</span>
                      </div>
                    ))}
                    {messages.length === 0 && <p className="empty">{threadLoading ? "Завантаження…" : "Повідомлень ще немає."}</p>}
                  </div>
                  {error && <p className="notice error" role="alert">{error}</p>}
                  <form className="chatReply" onSubmit={reply}>
                    <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Відповідь пацієнту у WhatsApp…" />
                    <button type="submit" disabled={sending || !draft.trim()}>{sending ? "…" : "Надіслати"}</button>
                  </form>
                </>}
          </section>
        </div>
      </div>;

  return (
    <StaffWorkspaceShell active="chat" title="Контакт-центр" description="Єдиний журнал комунікацій з пацієнтом: WhatsApp, Telegram, SMS та e-mail." staffName={staff?.displayName} staffRole={roleLabelUk(staff?.role)}>
      {body}
    </StaffWorkspaceShell>
  );
}
