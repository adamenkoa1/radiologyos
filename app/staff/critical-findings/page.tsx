"use client";

import { useCallback, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { roleLabelUk } from "../../../lib/labels";

type Finding = {
  id: number; bookingId: number; status: "open" | "communicated"; note: string;
  flaggedBy: string; flaggedAt: string; communicatedBy: string; communicatedAt: string; communicatedVia: string;
  bookingCode: string; patientName: string; service: string; desiredDate: string; performedAt: string;
};
type Staff = { email: string; displayName: string; role: string };

const fmt = (v: string) => (v ? new Date(v.includes("T") ? v : `${v.replace(" ", "T")}Z`).toLocaleString("uk-UA") : "—");

export default function CriticalFindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [via, setVia] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/critical-findings", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Не вдалося завантажити"); return; }
      setError(""); setFindings(data.findings || []); setStaff(data.staff || null);
    } catch {
      setError("Мережа недоступна");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  async function act(payload: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/staff/critical-findings", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setError(data.error || "Не вдалося виконати дію"); return; }
      await load();
    } catch {
      setError("Мережа недоступна");
    } finally {
      setBusy(false);
    }
  }

  return <StaffWorkspaceShell
    active="protocols"
    title="Критичні знахідки"
    description="Ургентні знахідки, які треба терміново довести лікарю/пацієнту, з фіксацією «донесено — ким і коли»."
    staffName={staff?.displayName || staff?.email}
    staffRole={roleLabelUk(staff?.role)}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fcritical-findings">Увійти для роботи</a></section> :
    <section className="reportPanel">
      {loading ? <p className="empty">Завантаження…</p> :
        findings.length === 0 ? <p className="empty">Відкритих критичних знахідок немає.</p> :
        <ul className="cfList">
          {findings.map((f) => <li key={f.id} className={`cfItem st-${f.status}`}>
            <div className="cfHead">
              <span className={`cfBadge st-${f.status}`}>{f.status === "open" ? "Потребує доведення" : "Доведено"}</span>
              <b>{f.patientName || "Без імені"}</b>
              <span className="cfMeta">{f.service} · {f.bookingCode} · {f.desiredDate}</span>
            </div>
            {f.note && <p className="cfNote">{f.note}</p>}
            <p className="cfMeta">Позначив: {f.flaggedBy} · {fmt(f.flaggedAt)}
              {f.status === "communicated" && ` → доведено: ${f.communicatedBy} (${f.communicatedVia}) · ${fmt(f.communicatedAt)}`}</p>
            <div className="cfActions">
              {f.status === "open" && <>
                <input placeholder="Як доведено (телефон, особисто…)" value={via[f.id] || ""}
                  onChange={(e) => setVia((s) => ({ ...s, [f.id]: e.target.value }))} />
                <button type="button" className="button compact" disabled={busy || !(via[f.id] || "").trim()}
                  onClick={() => void act({ action: "communicate", id: f.id, via: via[f.id] })}>Позначити доведеним</button>
              </>}
              <button type="button" className="button compact ghost" disabled={busy}
                onClick={() => void act({ action: "resolve", id: f.id })}>Закрити</button>
              <a className="crmVisitLink" href={`/staff/protocols?open=${f.bookingId}`}>Протокол →</a>
            </div>
          </li>)}
        </ul>}
    </section>}
  </StaffWorkspaceShell>;
}
