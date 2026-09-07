"use client";

import { useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { roleLabelUk } from "../../../lib/labels";

type Status = "ok" | "warn" | "alert";
type Card = { key: string; label: string; value: number; unit: string; status: Status; hint: string };
type Staff = { email: string; displayName: string; role: string };

const STATUS_LABEL: Record<Status, string> = { ok: "Норма", warn: "Увага", alert: "Критично" };

const fmt = (v: number, unit: string) =>
  unit === "грн" ? `${v.toLocaleString("uk-UA")} грн` : String(v);

export default function ManagementDashboardPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [attention, setAttention] = useState(0);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/staff/management/red-zones", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) { setError(data.error || "Не вдалося завантажити пульт"); return; }
        setCards(data.cards || []); setAttention(data.attention || 0); setStaff(data.staff || null);
      } catch {
        if (alive) setError("Мережа недоступна");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return <StaffWorkspaceShell
    active="overview"
    title="Пульт завідувача"
    description="Червоні зони відділення: операційні показники, що потребують уваги, — одним екраном."
    staffName={staff?.displayName || staff?.email}
    staffRole={roleLabelUk(staff?.role)}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fmanagement">Увійти для роботи</a></section> :
    <section className="reportPanel">
      <div className="kpiHeader">
        <span className={`kpiAttention ${attention ? "has" : "clear"}`}>
          {attention ? `${attention} зон уваги` : "Усе в нормі"}
        </span>
        <a className="button compact" href="/staff/reports/utilization">Завантаженість обладнання →</a>
      </div>
      {loading ? <p className="empty">Оновлюємо…</p> :
        <ul className="kpiGrid">
          {cards.map((c) => <li key={c.key} className={`kpiCard st-${c.status}`}>
            <span className="kpiStatus">{STATUS_LABEL[c.status]}</span>
            <b className="kpiValue">{fmt(c.value, c.unit)}</b>
            <span className="kpiLabel">{c.label}</span>
            <p className="kpiHint">{c.hint}</p>
          </li>)}
        </ul>}
    </section>}
  </StaffWorkspaceShell>;
}
