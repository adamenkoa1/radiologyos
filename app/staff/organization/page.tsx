"use client";

import { useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type Department = { id:number; name:string; slug?:string };
type Data = {
  organization:{ id:number; name:string; slug:string };
  role:string;
  member:{ email:string; displayName:string };
  departments:Department[];
  bookingsCount:number;
};

export default function OrganizationPage() {
  const [data,setData] = useState<Data|null>(null);
  const [error,setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const response = await fetch("/api/staff/org", { cache:"no-store" });
      const payload = await response.json().catch(()=>({})) as Data & { error?:string };
      if (!response.ok) { setError(payload.error || "Немає доступу"); return; }
      setData(payload); setError("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return <StaffWorkspaceShell
    active="organization"
    title="Організація"
    description="Дані закладу: назва, підрозділи й обсяг записів."
  >
    {error ? <section className="accessDenied">
      <b>Захищений розділ</b>
      <p>{error}. Увійдіть через дозволений робочий обліковий запис.</p>
      <a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Forganization">Увійти для роботи</a>
    </section> :
    !data ? <p className="dashLoading">Завантаження…</p> :
    <div className="orgProfile">
      <div className="orgProfileHead">
        <span className="studiesOrgBadge">{data.organization.name}</span>
        <small>Ви — <b>{data.member.displayName || data.member.email}</b> · роль: {data.role}</small>
      </div>

      <section className="orgProfileCard">
        <h3>Заклад</h3>
        <dl className="structMeta">
          <div><dt>Назва</dt><dd>{data.organization.name}</dd></div>
          <div><dt>Ідентифікатор</dt><dd>{data.organization.slug}</dd></div>
          <div><dt>Записів усього</dt><dd className="structAccent">{data.bookingsCount}</dd></div>
          <div><dt>Підрозділів</dt><dd>{data.departments.length}</dd></div>
        </dl>
      </section>

      {data.departments.length > 0 && <section className="orgProfileCard">
        <h3>Підрозділи</h3>
        <ul className="structStaff">
          {data.departments.map(d => <li key={d.id}><b>{d.name}</b>{d.slug ? <small>{d.slug}</small> : null}</li>)}
        </ul>
      </section>}

      <section className="orgProfileCard">
        <h3>Структура відділення</h3>
        <p className="orgProfileHint">Ліцензія, кабінети, обладнання, штат і режим роботи — на окремій сторінці.</p>
        <a className="button compact" href="/staff/structure">Відкрити структуру</a>
      </section>
    </div>}
  </StaffWorkspaceShell>;
}
