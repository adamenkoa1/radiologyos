"use client";

import { useCallback, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { roleLabelUk } from "../../../lib/labels";

type StaffInfo = { email: string; displayName: string; role: string };

// Українські підписи технічних ключів у полі «Деталі».
const DETAIL_KEY_LABELS: Record<string, string> = {
  role: "роль", channel: "канал", rows: "рядків", reason: "причина",
  status: "статус", email: "email", phone: "телефон", target: "обʼєкт",
  count: "кількість", name: "імʼя", field: "поле", value: "значення",
};
type AuditEvent = {
  id: number; actorEmail: string; action: string; resource: string;
  targetId: string; detailsJson: string; createdAt: string;
};

function fmtKyiv(iso: string): string {
  // created_at зберігається як UTC ("YYYY-MM-DD HH:MM:SS"); показуємо київський час.
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function actorLabel(email: string): string {
  // Внутрішні id виду "380...@phone.local" показуємо як номер телефону.
  const m = /^(\d{6,})@phone\.local$/.exec(email);
  return m ? `+${m[1]}` : email;
}

export default function StaffAuditPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const PAGE = 50;
  const load = useCallback(async (beforeId?: number) => {
    setBusy(true);
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (actor.trim()) params.set("actor", actor.trim());
    params.set("limit", String(PAGE));
    if (beforeId) params.set("beforeId", String(beforeId));
    try {
      const res = await fetch(`/api/staff/audit?${params.toString()}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        // Стіну доступу показуємо лише на першому завантаженні; при
        // «Показати ще» не стираємо вже завантажений список.
        if (!beforeId) setForbidden(true);
        return;
      }
      const data = await res.json().catch(() => ({})) as { events?: AuditEvent[]; labels?: Record<string, string>; staff?: StaffInfo };
      if (data.labels) setLabels(data.labels);
      if (data.staff) setStaff(data.staff);
      const batch = data.events ?? [];
      setEvents(prev => beforeId ? [...prev, ...batch] : batch);
      setMore(batch.length >= PAGE);
    } catch {
      if (!beforeId) setForbidden(false);
    } finally {
      setLoaded(true); setBusy(false);
    }
  }, [action, actor]);

  useEffect(() => {
    // Дебаунс: чекаємо паузу в наборі, щоб не бити запит на кожну літеру.
    const t = window.setTimeout(() => { void load(); }, 350);
    return () => window.clearTimeout(t);
  }, [load]);

  const body = forbidden
    ? <section className="accessDenied"><b>Захищений розділ</b><p>Журнал дій доступний лише адміністратору.</p></section>
    : !loaded
      ? <p className="dashLoading">Завантаження…</p>
      : <div className="auditWrap">
          <div className="auditFilters">
            <label><span>Подія</span>
              <select value={action} onChange={e => setAction(e.target.value)}>
                <option value="">Усі події</option>
                {Object.entries(labels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </label>
            <label><span>Хто (email / телефон)</span>
              <input type="search" value={actor} placeholder="частина email або номера" onChange={e => setActor(e.target.value)} />
            </label>
            <a
              className="button secondary auditExport"
              href={`/api/staff/audit?format=csv${action ? `&action=${encodeURIComponent(action)}` : ""}${actor.trim() ? `&actor=${encodeURIComponent(actor.trim())}` : ""}`}
            >Експорт CSV</a>
          </div>

          {events.length === 0
            ? <p className="auditEmpty">Подій не знайдено. Журнал наповнюється, коли співробітники входять у систему, змінюють налаштування чи керують персоналом.</p>
            : <div className="auditTableWrap">
                <table className="auditTable">
                  <thead><tr><th>Час (Київ)</th><th>Хто</th><th>Дія</th><th>Ресурс</th><th>Обʼєкт</th><th>Деталі</th></tr></thead>
                  <tbody>
                    {events.map(ev => {
                      let details = "";
                      try { const o = JSON.parse(ev.detailsJson || "{}"); details = Object.entries(o).map(([k, v]) => `${DETAIL_KEY_LABELS[k] || k}: ${v}`).join(", "); } catch { details = ev.detailsJson; }
                      const danger = ev.action === "login_failed";
                      return <tr key={ev.id} className={danger ? "auditDanger" : undefined}>
                        <td className="auditTime">{fmtKyiv(ev.createdAt)}</td>
                        <td>{actorLabel(ev.actorEmail)}</td>
                        <td><span className={`auditTag r-${ev.resource}`}>{labels[ev.action] || ev.action}</span></td>
                        <td>{ev.resource}</td>
                        <td className="auditTarget">{actorLabel(ev.targetId) || "—"}</td>
                        <td className="auditDetails">{details || "—"}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>}

          {more && <div className="auditMore"><button type="button" className="button secondary" disabled={busy} onClick={() => load(events[events.length - 1]?.id)}>{busy ? "Завантаження…" : "Показати ще"}</button></div>}
        </div>;

  return (
    <StaffWorkspaceShell
      active="audit"
      title="Журнал дій (аудит)"
      description="Хто, що і коли зробив у системі: входи, зміни налаштувань і графіка, керування персоналом."
      staffName={staff?.displayName}
      staffRole={roleLabelUk(staff?.role)}
    >
      {body}
    </StaffWorkspaceShell>
  );
}
