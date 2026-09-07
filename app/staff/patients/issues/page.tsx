"use client";

import { useEffect, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";

type StaffRole = "admin" | "organization_admin" | "department_head" | "registrar" | "radiologist" | "radiographer";
type StaffInfo = { email:string; displayName:string; role:StaffRole };

type Severity = "high" | "medium" | "low";
type Finding = {
  kind: string; severity: Severity; patientId: string; bookingId: number | null;
  code: string; phoneNormalized: string; title: string; detail: string; suggestion: string;
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

export default function PatientIssuesPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [counts, setCounts] = useState<Counts>({ high:0, medium:0, low:0, total:0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/staff/patients/issues", { headers: { "cache-control": "no-store" } });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) { setError(data.error || "Не вдалося завантажити аудит"); return; }
        setStaff(data.staff || null);
        setFindings(data.findings || []);
        setCounts(data.counts || { high:0, medium:0, low:0, total:0 });
      } catch {
        if (alive) setError("Мережа недоступна");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return <StaffWorkspaceShell
    active="patients"
    title="Неузгодженості карток"
    description="Аудит суперечностей між картками CRM, заявками й контактами: розбіжні телефони та ПІБ, спільні номери, заявки без картки. Read-only — нічого не змінює."
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
            <a className="crmVisitLink" href={patientHref(f)}>Відкрити картку →</a>
          </li>)}
        </ul>}
    </section>}
  </StaffWorkspaceShell>;
}
