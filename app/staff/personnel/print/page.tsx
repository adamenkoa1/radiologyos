"use client";

import { useEffect, useState } from "react";

type Assignment = { positionTitle:string; assignmentKind:string; duties:string; startsOn:string; endsOn:string; orderReference:string; departmentName:string|null; parentDepartmentName:string|null };
type ScheduleDay = { weekday:number; isWorking:number; startTime:string; endTime:string; breakStart:string; breakEnd:string };
type Schedule = { name:string; scheduleKind:string; validFrom:string; validTo:string; weeklyMinutes:number; note:string; days:ScheduleDay[] };
type Record_ = {
  staffNumber:string; employmentKind:string; displayName:string; dateOfBirth:string;
  militaryRank:string; positionTitle:string; departmentName:string|null;
  workPhone:string; personalPhone:string; workEmail:string; alternateEmail:string;
  region:string; city:string; addressLine:string; postalCode:string; accountEmail:string|null; active:number;
};
type PrintPayload = { templateVersion:number; formType:"personnel_card"; organization:{name:string}; record:Record_; assignments:Assignment[]; schedule:Schedule|null };
type Snapshot = { id:number; templateVersion:number; sha256:string; generatedBy:string; generatedAt:string };
type ResponsePayload = { snapshot:Snapshot; payload:PrintPayload; error?:string };

const EMPLOYMENT_UK:Record<string,string> = { unspecified:"Не визначено", military:"Військовослужбовець", civilian:"Працівник ЗСУ / цивільний", contractor:"Сумісник / контрактний", other:"Інше" };
const ASSIGNMENT_UK:Record<string,string> = { primary:"Основна посада", acting:"ТВО", secondary:"Суміщення", temporary:"Тимчасове", other:"Інше" };
const KIND_UK:Record<string,string> = { five_day:"П’ятиденний", six_day:"Шестиденний", shift:"Змінний", individual:"Індивідуальний", other:"Інший" };
const WEEKDAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];
function hours(minutes:number){ const h=Math.floor((minutes||0)/60); const m=(minutes||0)%60; return m?`${h} год ${m} хв`:`${h} год`; }

export default function PersonnelPrintPage() {
  const [data, setData] = useState<ResponsePayload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const id = (new URLSearchParams(window.location.search).get("id") || "").trim();
      if (!id) { setError("Некоректна кадрова картка"); return; }
      void fetch("/api/staff/personnel/print", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ personnelId:id }), signal:controller.signal })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({})) as ResponsePayload;
          if (!response.ok) throw new Error(payload.error || "Не вдалося сформувати картку");
          setData(payload);
        })
        .catch((e) => { if (e?.name !== "AbortError") setError(e instanceof Error ? e.message : "Помилка друку"); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, []);

  if (error) return <main className="financePrintPage"><div className="financePrintSheet"><h1>Не вдалося сформувати картку</h1><p>{error}</p></div></main>;
  if (!data) return <main className="financePrintPage"><div className="financePrintSheet"><p>Формування картки…</p></div></main>;
  const { payload, snapshot } = data;
  const r = payload.record;
  const address = [r.postalCode, r.region, r.city, r.addressLine].filter(Boolean).join(", ");
  return <main className="financePrintPage">
    <div className="financePrintToolbar"><button onClick={() => window.close()}>Закрити</button><button onClick={() => window.print()}>Друкувати</button></div>
    <article className="financePrintSheet">
      <header><div><small>{payload.organization.name}</small><h1>Кадрова картка</h1><p>{r.displayName}</p></div><strong>{r.active ? "Працює" : "Архів"}</strong></header>
      <section className="financePrintMeta">
        <div><span>Табельний №</span><b>{r.staffNumber || "—"}</b></div>
        <div><span>Категорія</span><b>{EMPLOYMENT_UK[r.employmentKind] || r.employmentKind}</b></div>
        <div><span>Посада</span><b>{r.positionTitle || "—"}</b></div>
        <div><span>Звання</span><b>{r.militaryRank || "—"}</b></div>
        <div><span>Підрозділ</span><b>{r.departmentName || "—"}</b></div>
        <div><span>Дата народження</span><b>{r.dateOfBirth || "—"}</b></div>
        <div><span>Робочий телефон</span><b>{r.workPhone || "—"}</b></div>
        <div><span>Особистий телефон</span><b>{r.personalPhone || "—"}</b></div>
        <div><span>Робочий e-mail</span><b>{r.workEmail || "—"}</b></div>
        <div><span>Обліковий запис</span><b>{r.accountEmail || "Без облікового запису"}</b></div>
      </section>
      {address && <section className="financePrintDetails"><p><span>Адреса</span><b>{address}</b></p></section>}

      <section className="financePrintDetails">
        <h2 style={{margin:"6px 0"}}>Призначення</h2>
        {payload.assignments.length ? payload.assignments.map((a, i) => (
          <p key={i}><span>{ASSIGNMENT_UK[a.assignmentKind] || a.assignmentKind}</span><b>{a.positionTitle}{a.departmentName ? ` · ${a.parentDepartmentName ? `${a.parentDepartmentName} → ` : ""}${a.departmentName}` : ""}{` · ${a.startsOn || "—"} → ${a.endsOn || "дотепер"}`}{a.orderReference ? ` · ${a.orderReference}` : ""}</b></p>
        )) : <p><span>—</span><b>Призначення не внесено</b></p>}
      </section>

      {payload.schedule && <section className="financePrintDetails">
        <h2 style={{margin:"6px 0"}}>Графік роботи · {KIND_UK[payload.schedule.scheduleKind] || payload.schedule.scheduleKind} · {hours(payload.schedule.weeklyMinutes)}/тиждень</h2>
        <p><span>Період</span><b>{payload.schedule.validFrom || "—"} → {payload.schedule.validTo || "дотепер"}</b></p>
        <p><span>Дні</span><b>{payload.schedule.days.filter((d) => d.isWorking).map((d) => `${WEEKDAYS[d.weekday - 1]} ${d.startTime}–${d.endTime}`).join("; ") || "Не задано"}</b></p>
      </section>}

      <section className="financePrintFooter"><div><span>Сформував</span><b>{snapshot.generatedBy}</b></div><div><span>Підпис</span><i/></div></section>
      <p className="financePrintVersion">Форма v{snapshot.templateVersion} · snapshot #{snapshot.id} · SHA-256 {snapshot.sha256.slice(0, 12)}…</p>
    </article>
  </main>;
}
