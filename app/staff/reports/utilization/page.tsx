"use client";

import { useCallback, useEffect, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";
import { roleLabelUk } from "../../../../lib/labels";

type Row = {
  equipmentId: string; label: string; workingDays: number;
  capacityMinutes: number; performedMinutes: number; performedCount: number;
  bookedMinutes: number; utilizationPct: number; bookedPct: number; idleMinutes: number;
};
type Totals = Omit<Row, "equipmentId" | "label">;
type Staff = { email: string; displayName: string; role: string };

const hrs = (m: number) => (m / 60).toLocaleString("uk-UA", { maximumFractionDigits: 1 });

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function UtilBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tone = pct >= 85 ? "#b53a2b" : pct >= 55 ? "var(--green)" : "var(--orange)";
  return <div className="reportBarTrack" title={`${pct}%`}>
    <i style={{ width: `${clamped}%`, background: tone }} />
  </div>;
}

export default function UtilizationReportPage() {
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (f: string, t: string) => {
    try {
      const res = await fetch(`/api/staff/reports/utilization?from=${f}&to=${t}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Не вдалося завантажити звіт"); return; }
      setError(""); setRows(data.rows || []); setTotals(data.totals || null); setStaff(data.staff || null);
    } catch {
      setError("Мережа недоступна");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { (async () => { await load(init.from, init.to); })(); }, [load, init.from, init.to]);

  function apply() { setLoading(true); void load(from, to); }

  return <StaffWorkspaceShell
    active="reports"
    title="Завантаженість обладнання"
    description="Потужність за графіком проти фактично виконаного та заброньованого — з простоєм по кожному апарату."
    staffName={staff?.displayName || staff?.email}
    staffRole={roleLabelUk(staff?.role)}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Freports%2Futilization">Увійти для роботи</a></section> :
    <section className="reportPanel">
      <div className="utilFilters">
        <label>Від <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>До <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" className="button" onClick={apply} disabled={loading}>{loading ? "…" : "Оновити"}</button>
        <a className="button compact" href="/staff/reports">← До звітів</a>
      </div>
      {loading ? <p className="empty">Рахуємо…</p> :
        <div className="reportTableScroll">
          <table className="utilTable">
            <thead>
              <tr>
                <th>Апарат</th><th>Робочих днів</th><th>Потужність, год</th>
                <th>Виконано, год</th><th>Завантаження</th><th>Заброньовано</th><th>Простій, год</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <tr key={r.equipmentId}>
                <td>{r.label}</td>
                <td className="num">{r.workingDays}</td>
                <td className="num">{hrs(r.capacityMinutes)}</td>
                <td className="num">{hrs(r.performedMinutes)} <small>({r.performedCount})</small></td>
                <td><div className="utilCell"><UtilBar pct={r.utilizationPct} /><b>{r.utilizationPct}%</b></div></td>
                <td className="num">{r.bookedPct}%</td>
                <td className="num">{hrs(r.idleMinutes)}</td>
              </tr>)}
            </tbody>
            {totals && <tfoot>
              <tr>
                <th>Разом</th>
                <th className="num">{totals.workingDays}</th>
                <th className="num">{hrs(totals.capacityMinutes)}</th>
                <th className="num">{hrs(totals.performedMinutes)} <small>({totals.performedCount})</small></th>
                <th className="num">{totals.utilizationPct}%</th>
                <th className="num">{totals.bookedPct}%</th>
                <th className="num">{hrs(totals.idleMinutes)}</th>
              </tr>
            </tfoot>}
          </table>
        </div>}
      <p className="utilHint">Потужність = робочі дні за графіком × денне вікно апарата мінус обід. «Виконано» — за фактом проведення (performed_at), «заброньовано» — усі незскасовані записи періоду. Свято зменшує потужність, лише якщо його додано у вихідні дні графіка.</p>
    </section>}
  </StaffWorkspaceShell>;
}
