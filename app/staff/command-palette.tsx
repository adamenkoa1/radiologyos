"use client";

// Командна палітра (⌘K / Ctrl+K): миттєвий пошук пацієнта/заявки за ПІБ,
// телефоном чи кодом + швидка навігація. Керування лише клавіатурою.
// Монтується один раз у Workspace-shell, доступна на всіх staff-сторінках.

import { useEffect, useRef, useState } from "react";

type Booking = {
  id: number; code: string; name: string; phone: string;
  service: string; desiredDate: string; desiredTime: string; statusLabel: string;
};

const COMMANDS: { label: string; hint: string; href: string }[] = [
  { label: "Пульт відділення", hint: "огляд дня", href: "/staff/dashboard" },
  { label: "Прийом", hint: "черга заявок", href: "/staff/intake" },
  { label: "Календар записів", hint: "розклад", href: "/staff/appointments" },
  { label: "Нова заявка", hint: "записати пацієнта", href: "/staff/book" },
  { label: "Пацієнти", hint: "картки / CRM", href: "/staff/patients" },
  { label: "Протоколи", hint: "опис досліджень", href: "/staff/protocols" },
  { label: "Звіти", hint: "аналітика", href: "/staff/reports" },
  { label: "Налаштування", hint: "адміністрування", href: "/staff/settings" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Глобальний хоткей ⌘K / Ctrl+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (open) { setActive(0); inputRef.current?.focus(); }
      else { setQ(""); setBookings([]); }
    }, 20);
    return () => window.clearTimeout(t);
  }, [open]);

  // Пошук заявок із дебаунсом; збіг за ПІБ / телефоном / кодом RD.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      const t0 = window.setTimeout(() => setBookings([]), 0);
      return () => window.clearTimeout(t0);
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/api/staff/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setBookings(Array.isArray(d.results) ? d.results : []))
        .catch(() => {});
    }, 180);
    return () => { ctrl.abort(); window.clearTimeout(t); };
  }, [q, open]);

  const cmds = COMMANDS.filter((c) => !q.trim() || `${c.label} ${c.hint}`.toLowerCase().includes(q.trim().toLowerCase()));
  const items: { key: string; go: () => void; render: () => React.ReactNode }[] = [
    ...cmds.map((c) => ({
      key: `cmd-${c.href}`,
      go: () => window.location.assign(c.href),
      render: () => <><span className="cmdkIcon">→</span><span className="cmdkMain">{c.label}</span><span className="cmdkHint">{c.hint}</span></>,
    })),
    ...bookings.map((b) => ({
      key: `bk-${b.id}`,
      go: () => window.location.assign(`/staff?open=${b.id}`),
      render: () => <><span className="cmdkIcon">🔖</span><span className="cmdkMain">{b.name || "Без імені"} · {b.code}</span><span className="cmdkHint">{b.service} · {b.desiredDate}{b.desiredTime ? ` ${b.desiredTime}` : ""} · {b.statusLabel}</span></>,
    })),
  ];

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
    else if (e.key === "Enter") { e.preventDefault(); items[Math.min(active, items.length - 1)]?.go(); }
  }

  if (!open) return null;
  return (
    <div className="cmdkOverlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Командна палітра">
      <div className="cmdkBox" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdkInput"
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          placeholder="Пошук пацієнта, коду RD, телефону… або команда"
          aria-label="Пошук"
        />
        <ul className="cmdkList">
          {items.length === 0
            ? <li className="cmdkEmpty">{q.trim().length < 2 ? "Почніть вводити…" : "Нічого не знайдено"}</li>
            : items.map((it, i) => (
              <li key={it.key} className={`cmdkItem${i === active ? " on" : ""}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); it.go(); }}>
                {it.render()}
              </li>
            ))}
        </ul>
        <div className="cmdkFoot"><kbd>↑↓</kbd> вибір · <kbd>↵</kbd> відкрити · <kbd>Esc</kbd> закрити · <kbd>⌘K</kbd> виклик</div>
      </div>
    </div>
  );
}
