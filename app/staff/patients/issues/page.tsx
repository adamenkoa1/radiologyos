"use client";

import { useCallback, useEffect, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type StaffRole = "admin" | "organization_admin" | "department_head" | "registrar" | "radiologist" | "radiographer";
type StaffInfo = { email:string; displayName:string; role:StaffRole };

type Severity = "high" | "medium" | "low";
type Member = { patientId:string; displayName:string; birthDate:string };
type Finding = {
  kind: string; severity: Severity; patientId: string; bookingId: number | null;
  code: string; phoneNormalized: string; title: string; detail: string; suggestion: string;
  members?: Member[];
};
type Counts = { high:number; medium:number; low:number; total:number };

const roleLabels: Record<string,string> = {
  admin:"Адміністратор", organization_admin:"Адміністратор організації",
  department_head:"Завідувач відділення", registrar:"Реєстратор",
  radiologist:"Лікар-рентгенолог", radiographer:"Рентгенолаборант",
};
const severityLabels: Record<Severity,string> = { high:"Високий", medium:"Середній", low:"Низький" };
const kindLabels: Record<string,string> = {
  stale_contact:"Розбіжність контакту", duplicate_phone:"Спільний номер",
  linkable_booking:"Можна привʼязати", name_divergence:"Розбіжність ПІБ",
};

function patientHref(f: Finding): string {
  if (f.patientId) return `/staff/patients?patientId=${encodeURIComponent(f.patientId)}`;
  if (f.phoneNormalized) return `/staff/patients?phone=${encodeURIComponent(f.phoneNormalized)}`;
  return "/staff/patients";
}

function DuplicateMerge({ finding, onMerged }: { finding: Finding; onMerged: () => void }) {
  const members = finding.members || [];
  const [survivor, setSurvivor] = useState(members[0]?.patientId || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const merge = async () => {
    const absorbedIds = members.map((m) => m.patientId).filter((id) => id !== survivor);
    if (!survivor || !absorbedIds.length) { setErr("Оберіть головну картку"); return; }
    const keep = members.find((m) => m.patientId === survivor);
    if (!window.confirm(
      `Обʼєднати ${absorbedIds.length + 1} карток у одну?\n\n` +
      `Головна (залишиться): ${keep?.displayName || "без імені"}.\n` +
      `Уся історія інших карток перейде до неї, а вони будуть видалені. ` +
      `Прапорці «контраст» і «не турбувати» та нотатки алергій зберігаються. Дію не можна скасувати.`
    )) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/staff/patients/issues", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ survivorId: survivor, absorbedIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "Не вдалося обʼєднати"); return; }
      onMerged();
    } catch {
      setErr("Мережа недоступна");
    } finally {
      setBusy(false);
    }
  };

  return <div className="mergeBox">
    <p className="mergeHint">Оберіть головну картку — решта приєднаються до неї:</p>
    <ul className="mergeMembers">
      {members.map((m) => <li key={m.patientId}>
        <label>
          <input type="radio" name={`survivor-${finding.phoneNormalized}`} checked={survivor === m.patientId}
            onChange={() => setSurvivor(m.patientId)} disabled={busy} />
          <b>{m.displayName || "без імені"}</b>
          {m.birthDate ? <small> · {m.birthDate}</small> : null}
        </label>
        <a className="crmVisitLink" href={`/staff/patients?patientId=${encodeURIComponent(m.patientId)}`} target="_blank" rel="noreferrer">картка →</a>
      </li>)}
    </ul>
    {err ? <p className="mergeError">{err}</p> : null}
    <button type="button" className="crmAddBtn" onClick={() => void merge()} disabled={busy}>
      {busy ? "Обʼєднуємо…" : "Обʼєднати картки"}
    </button>
  </div>;
}

export default function PatientIssuesPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [counts, setCounts] = useState<Counts>({ high:0, medium:0, low:0, total:0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/patients/issues", { headers: { "cache-control": "no-store" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Не вдалося завантажити аудит"); return; }
      setError("");
      setStaff(data.staff || null);
      setFindings(data.findings || []);
      setCounts(data.counts || { high:0, medium:0, low:0, total:0 });
    } catch {
      setError("Мережа недоступна");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  const isAdmin = staff?.role === "admin";

  return <StaffWorkspaceShell
    active="patients"
    title="Неузгодженості карток"
    description="Аудит суперечностей між картками CRM, заявками й контактами: розбіжні телефони та ПІБ, спільні номери, заявки без картки. Read-only, крім злиття дублікатів (лише адмін)."
    staffName={staff?.displayName || staff?.email}
    staffRole={staff ? roleLabels[staff.role] : undefined}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fpatients%2Fissues">Увійти для роботи</a></section> :
    <section className="reportPanel">
      <div className="consistencySummary">
        <span className="consistencyBadge sev-high">Високий: <b>{counts.high}</b></span>
        <span className="consistencyBadge sev-medium">Середній: <b>{counts.medium}</b></span>
        <span className="consistencyBadge sev-low">Низький: <b>{counts.low}</b></span>
        <a className="button compact" href="/staff/patients">← До карток</a>
      </div>
      {loading ? <p className="empty">Перевіряємо…</p> :
        findings.length === 0 ? <p className="empty">Суперечностей не знайдено — дані карток узгоджені.</p> :
        <ul className="consistencyList">
          {findings.map((f, i) => <li key={`${f.kind}:${f.bookingId ?? f.phoneNormalized}:${i}`} className={`consistencyItem sev-${f.severity}`}>
            <div className="consistencyItemHead">
              <span className={`consistencyBadge sev-${f.severity}`}>{severityLabels[f.severity]}</span>
              <span className="consistencyKind">{kindLabels[f.kind] || f.kind}</span>
            </div>
            <b>{f.title}</b>
            <p className="consistencyDetail">{f.detail}</p>
            <p className="consistencySuggestion">{f.suggestion}</p>
            {f.kind === "duplicate_phone" && isAdmin && (f.members?.length || 0) >= 2
              ? <DuplicateMerge finding={f} onMerged={() => void load()} />
              : <a className="crmVisitLink" href={patientHref(f)}>Відкрити картку →</a>}
          </li>)}
        </ul>}
    </section>}
  </StaffWorkspaceShell>;
}
