"use client";

// Command palette (⌘K / Ctrl+K): global role-aware search plus fast navigation.

import { useEffect, useRef, useState } from "react";

type SearchResult = {
  key: string;
  type: "booking" | "imaging" | "protocol" | "equipment" | "maintenance";
  title: string;
  subtitle: string;
  href: string;
};

const COMMANDS: { label: string; hint: string; href: string }[] = [
  { label: "Пульт відділення", hint: "огляд дня", href: "/staff/dashboard" },
  { label: "Прийом", hint: "черга заявок", href: "/staff/intake" },
  { label: "Календар записів", hint: "розклад", href: "/staff/appointments" },
  { label: "Нова заявка", hint: "записати пацієнта", href: "/staff/book" },
  { label: "Пацієнти", hint: "картки / CRM", href: "/staff/patients" },
  { label: "Протоколи", hint: "опис досліджень", href: "/staff/protocols" },
  { label: "DICOM", hint: "знімки та PACS", href: "/staff/imaging" },
  { label: "Склад", hint: "витратні матеріали", href: "/staff/inventory" },
  { label: "ТО та несправності", hint: "обладнання / сервіс", href: "/staff/maintenance" },
  { label: "Звіти", hint: "аналітика", href: "/staff/reports" },
  { label: "Стан системи", hint: "health / production", href: "/staff/system/health" },
  { label: "Налаштування", hint: "адміністрування", href: "/staff/settings" },
];

const TYPE_LABEL:Record<SearchResult["type"],string> = {
  booking:"Пацієнт / заявка",
  imaging:"DICOM",
  protocol:"Протокол",
  equipment:"Обладнання",
  maintenance:"ТО / сервіс",
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
      else { setQ(""); setResults([]); }
    }, 20);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      const t0 = window.setTimeout(() => setResults([]), 0);
      return () => window.clearTimeout(t0);
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/api/staff/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(Array.isArray(d.results) ? d.results : []))
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
    ...results.map((r) => ({
      key: r.key,
      go: () => window.location.assign(r.href),
      render: () => <><span className={`cmdkType cmdkType-${r.type}`}>{TYPE_LABEL[r.type]}</span><span className="cmdkMain">{r.title}</span><span className="cmdkHint">{r.subtitle}</span></>,
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
          placeholder="ПІБ, телефон, RD, accession, протокол, обладнання…"
          aria-label="Глобальний пошук"
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
