"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";

type PersonnelRecord = {
  id:string; accountEmail:string | null; staffNumber:string; employmentKind:string;
  lastName:string; firstName:string; patronymic:string; displayName:string; dateOfBirth:string;
  militaryRank:string; positionTitle:string; departmentId:number | null; departmentName:string | null;
  workPhone:string; personalPhone:string; workEmail:string; alternateEmail:string;
  region:string; city:string; addressLine:string; postalCode:string; photoStorageKey:string;
  active:number; createdAt:string; updatedAt:string; vlkDecisionCode:string | null; vlkValidUntil:string | null;
};
type Department = { id:number; name:string; active:number };
type Account = { email:string; displayName:string; phone:string; role:string; active:number };
type DepartmentStructure = {
  departmentId:number; departmentName:string; parentDepartmentId:number | null;
  parentDepartmentName:string | null; unitType:string;
};
type Assignment = {
  id:string; personnelId:string; departmentId:number | null; departmentName:string | null;
  parentDepartmentId:number | null; parentDepartmentName:string | null; positionTitle:string;
  assignmentKind:string; duties:string; startsOn:string; endsOn:string; orderReference:string;
  createdAt:string; updatedAt:string;
};
type WorkSchedule = {
  id:string; personnelId:string; name:string; scheduleKind:string; validFrom:string; validTo:string;
  weeklyMinutes:number; note:string; active:number; createdAt:string; updatedAt:string;
};
type WorkScheduleDay = {
  scheduleId:string; weekday:number; isWorking:number; startTime:string; endTime:string;
  breakStart:string; breakEnd:string;
};
type ApiData = {
  records:PersonnelRecord[]; departments:Department[]; accounts:Account[];
  departmentStructure:DepartmentStructure[]; assignments:Assignment[];
  workSchedules:WorkSchedule[]; workScheduleDays:WorkScheduleDay[]; error?:string;
};

type DayDraft = {
  weekday:number; isWorking:boolean; startTime:string; endTime:string; breakStart:string; breakEnd:string;
};

const EMPLOYMENT = [
  ["unspecified", "Не визначено"],
  ["military", "Військовослужбовець"],
  ["civilian", "Працівник ЗСУ / цивільний"],
  ["contractor", "Сумісник / контрактний"],
  ["other", "Інше"],
] as const;
const ASSIGNMENT_KINDS = [
  ["primary", "Основна посада"], ["acting", "Тимчасове виконання обов’язків"],
  ["secondary", "Додаткова посада / суміщення"], ["temporary", "Тимчасове призначення"], ["other", "Інше"],
] as const;
const SCHEDULE_KINDS = [
  ["five_day", "П’ятиденний"], ["six_day", "Шестиденний"], ["shift", "Змінний"],
  ["individual", "Індивідуальний"], ["other", "Інший"],
] as const;
const WEEKDAYS = ["Понеділок", "Вівторок", "Середа", "Четвер", "П’ятниця", "Субота", "Неділя"];
const POSITIONS = [
  "Начальник відділення променевої діагностики", "Лікар-рентгенолог", "Рентгенолаборант",
  "Молодша медична сестра", "Начальник ПРК", "ТВО начальника ПРК", "Рентгенолаборант ПРК",
  "Водій-електрик ПРК", "Начальник кабінету УЗД", "Лікар ультразвукової діагностики",
];
const RANKS = [
  "Цивільний персонал", "Солдат", "Старший солдат", "Молодший сержант", "Сержант",
  "Старший сержант", "Головний сержант", "Штаб-сержант", "Молодший лейтенант",
  "Лейтенант", "Старший лейтенант", "Капітан", "Майор", "Підполковник", "Полковник",
];

function emptyWeek():DayDraft[] {
  return Array.from({ length:7 }, (_, index) => ({
    weekday:index + 1, isWorking:false, startTime:"", endTime:"", breakStart:"", breakEnd:"",
  }));
}

function initials(record:PersonnelRecord) {
  return `${record.firstName?.[0] || ""}${record.lastName?.[0] || ""}`.toUpperCase() || "?";
}

function employmentLabel(value:string) {
  return EMPLOYMENT.find(([key]) => key === value)?.[1] || value || "Не визначено";
}

function assignmentKindLabel(value:string) {
  return ASSIGNMENT_KINDS.find(([key]) => key === value)?.[1] || value;
}

function scheduleKindLabel(value:string) {
  return SCHEDULE_KINDS.find(([key]) => key === value)?.[1] || value;
}

function vlkLabel(value:string | null) {
  return ({ fit:"Придатний", temporarily_unfit:"Тимчасово непридатний", unfit:"Непридатний", other:"Інше рішення" } as Record<string,string>)[value || ""] || "Немає запису";
}

function hoursLabel(minutes:number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} год ${rest} хв` : `${hours} год`;
}

export default function PersonnelPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [assignmentEditor, setAssignmentEditor] = useState<Assignment | null>(null);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState<WorkSchedule | null>(null);
  const [scheduleDays, setScheduleDays] = useState<DayDraft[]>(emptyWeek);
  const [showScheduleForm, setShowScheduleForm] = useState(false);

  const load = useCallback(async (preferredId?:string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/staff/personnel", { cache:"no-store" });
      const body = await response.json().catch(() => ({})) as Partial<ApiData>;
      if (!response.ok) throw new Error(body.error || "Не вдалося завантажити персонал");
      const next:ApiData = {
        records:body.records || [], departments:body.departments || [], accounts:body.accounts || [],
        departmentStructure:body.departmentStructure || [], assignments:body.assignments || [],
        workSchedules:body.workSchedules || [], workScheduleDays:body.workScheduleDays || [],
      };
      setData(next);
      if (preferredId && next.records.some((record) => record.id === preferredId)) setSelectedId(preferredId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити персонал");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selected = useMemo(() => data?.records.find((record) => record.id === selectedId) || null, [data, selectedId]);
  const selectedAssignments = useMemo(
    () => (data?.assignments || []).filter((row) => row.personnelId === selectedId), [data, selectedId],
  );
  const selectedSchedules = useMemo(
    () => (data?.workSchedules || []).filter((row) => row.personnelId === selectedId), [data, selectedId],
  );
  const currentSchedule = selectedSchedules.find((row) => row.active && !row.validTo) || selectedSchedules[0] || null;
  const linkedAccounts = useMemo(
    () => new Set((data?.records || []).filter((record) => record.id !== selectedId && record.accountEmail).map((record) => record.accountEmail as string)),
    [data, selectedId],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.records || []).filter((record) => {
      if (departmentFilter !== "all" && String(record.departmentId || "") !== departmentFilter) return false;
      if (!needle) return true;
      return [record.displayName, record.positionTitle, record.departmentName, record.workPhone, record.workEmail, record.militaryRank]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [data, departmentFilter, query]);

  function startCreate() {
    setCreating(true); setSelectedId(""); setNotice(""); setError("");
    setShowAssignmentForm(false); setShowScheduleForm(false);
  }
  function startEdit(id:string) {
    setCreating(false); setSelectedId(id); setNotice(""); setError("");
    setShowAssignmentForm(false); setShowScheduleForm(false); setAssignmentEditor(null); setScheduleEditor(null);
  }
  function closeEditor() {
    setCreating(false); setSelectedId(""); setError(""); setShowAssignmentForm(false); setShowScheduleForm(false);
  }

  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      id:selected?.id, accountEmail:String(form.get("accountEmail") || "") || null,
      staffNumber:String(form.get("staffNumber") || ""), employmentKind:String(form.get("employmentKind") || "unspecified"),
      lastName:String(form.get("lastName") || ""), firstName:String(form.get("firstName") || ""), patronymic:String(form.get("patronymic") || ""),
      dateOfBirth:String(form.get("dateOfBirth") || ""), militaryRank:String(form.get("militaryRank") || ""),
      positionTitle:String(form.get("positionTitle") || ""), departmentId:String(form.get("departmentId") || "") || null,
      workPhone:String(form.get("workPhone") || ""), personalPhone:String(form.get("personalPhone") || ""),
      workEmail:String(form.get("workEmail") || ""), alternateEmail:String(form.get("alternateEmail") || ""),
      region:String(form.get("region") || ""), city:String(form.get("city") || ""), addressLine:String(form.get("addressLine") || ""),
      postalCode:String(form.get("postalCode") || ""), active:form.get("active") === "on",
    };
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/staff/personnel", {
        method:selected ? "PATCH" : "POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { ok?:boolean; id?:string; error?:string };
      if (!response.ok || !body.ok || !body.id) throw new Error(body.error || "Не вдалося зберегти картку");
      await load(body.id); setCreating(false); setSelectedId(body.id);
      setNotice(selected ? "Картку працівника оновлено." : "Працівника додано до кадрового довідника.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зберегти картку"); }
    finally { setSaving(false); }
  }

  async function saveAssignment(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      action:"assignment", assignmentId:assignmentEditor?.id, personnelId:selected.id,
      departmentId:String(form.get("assignmentDepartmentId") || "") || null,
      positionTitle:String(form.get("assignmentPositionTitle") || ""),
      assignmentKind:String(form.get("assignmentKind") || "primary"), duties:String(form.get("duties") || ""),
      startsOn:String(form.get("startsOn") || ""), endsOn:String(form.get("endsOn") || ""),
      orderReference:String(form.get("orderReference") || ""),
    };
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/staff/personnel", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as {ok?:boolean;error?:string};
      if (!response.ok || !body.ok) throw new Error(body.error || "Не вдалося зберегти призначення");
      await load(selected.id); setShowAssignmentForm(false); setAssignmentEditor(null);
      setNotice("Призначення та посадові обов’язки збережено.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зберегти призначення"); }
    finally { setSaving(false); }
  }

  function editAssignment(row:Assignment) { setAssignmentEditor(row); setShowAssignmentForm(true); setNotice(""); setError(""); }
  function newAssignment() { setAssignmentEditor(null); setShowAssignmentForm(true); setNotice(""); setError(""); }

  function loadScheduleDraft(schedule:WorkSchedule | null) {
    setScheduleEditor(schedule);
    if (!schedule) { setScheduleDays(emptyWeek()); return; }
    const byWeekday = new Map((data?.workScheduleDays || []).filter((row) => row.scheduleId === schedule.id).map((row) => [row.weekday, row]));
    setScheduleDays(Array.from({length:7}, (_, index) => {
      const row = byWeekday.get(index + 1);
      return { weekday:index + 1, isWorking:Boolean(row?.isWorking), startTime:row?.startTime || "", endTime:row?.endTime || "", breakStart:row?.breakStart || "", breakEnd:row?.breakEnd || "" };
    }));
  }
  function editSchedule(schedule:WorkSchedule) { loadScheduleDraft(schedule); setShowScheduleForm(true); setNotice(""); setError(""); }
  function newSchedule() { loadScheduleDraft(null); setShowScheduleForm(true); setNotice(""); setError(""); }
  function updateDay(weekday:number, patch:Partial<DayDraft>) {
    setScheduleDays((current) => current.map((day) => day.weekday === weekday ? {...day, ...patch} : day));
  }

  async function saveSchedule(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      action:"work_schedule", scheduleId:scheduleEditor?.id, personnelId:selected.id,
      name:String(form.get("scheduleName") || ""), scheduleKind:String(form.get("scheduleKind") || "individual"),
      validFrom:String(form.get("validFrom") || ""), validTo:String(form.get("validTo") || ""),
      note:String(form.get("scheduleNote") || ""), active:form.get("scheduleActive") === "on", days:scheduleDays,
    };
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/staff/personnel", {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload)});
      const body = await response.json().catch(() => ({})) as {ok?:boolean;error?:string;weeklyMinutes?:number};
      if (!response.ok || !body.ok) throw new Error(body.error || "Не вдалося зберегти графік роботи");
      await load(selected.id); setShowScheduleForm(false); setScheduleEditor(null);
      setNotice(`Графік роботи збережено${typeof body.weeklyMinutes === "number" ? ` · ${hoursLabel(body.weeklyMinutes)} на тиждень` : ""}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зберегти графік роботи"); }
    finally { setSaving(false); }
  }

  const editorRecord = selected;
  const showEditor = creating || Boolean(editorRecord);
  const hierarchyLabel = (departmentId:number | null, departmentName?:string | null) => {
    if (!departmentId) return departmentName || "Підрозділ не вказано";
    const structure = data?.departmentStructure.find((row) => row.departmentId === departmentId);
    return structure?.parentDepartmentName ? `${structure.parentDepartmentName} → ${structure.departmentName}` : (structure?.departmentName || departmentName || "Підрозділ не вказано");
  };

  return <StaffWorkspaceShell active="directories" title="Персонал" description="Єдина кадрова картка працівника: особа, призначення, підрозділи, посадові обов’язки, графік роботи та кадрові допуски.">
    <section className="financeSummary" aria-label="Стан кадрового довідника">
      <article><span>Працівники</span><b>{data?.records.filter((record) => record.active).length || 0}</b><small>активні картки</small></article>
      <article><span>Структура</span><b>{data?.departments.length || 0}</b><small>відділення й підрозділи</small></article>
      <article><span>З акаунтом</span><b>{data?.records.filter((record) => record.accountEmail).length || 0}</b><small>мають вхід у RadiologyOS</small></article>
      <article><span>Чергування</span><b>Calendar6</b><small><Link href="/staff/shifts">окремий графік змін</Link></small></article>
    </section>

    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Зведений реєстр персоналу</b><small>Одна людина має одну кадрову картку та може мати кілька призначень. ВЛК, ДІВ, навчання й дозиметрія вже ведуться за тим самим personnelId.</small></div><div className="shiftPlannerActions"><button className="button primary" type="button" onClick={startCreate}>+ Додати працівника</button></div></header>
      <div className="shiftPlannerToolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук за ПІБ, посадою, телефоном…" aria-label="Пошук персоналу" />
        <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} aria-label="Фільтр підрозділу"><option value="all">Усі підрозділи</option>{(data?.departments || []).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
      </div>
      {loading ? <p className="notice">Завантаження персоналу…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Працівник</th><th>Підрозділ / основна посада</th><th>Службові дані</th><th>ВЛК</th><th>Статус</th><th/></tr></thead>
        <tbody>{filtered.map((record) => <tr key={record.id}>
          <td><div style={{display:"flex",alignItems:"center",gap:8}}><span className="statusPill">{initials(record)}</span><div><b>{record.displayName}</b><br/><small>{record.staffNumber ? `Таб. № ${record.staffNumber}` : employmentLabel(record.employmentKind)}</small></div></div></td>
          <td><b>{hierarchyLabel(record.departmentId, record.departmentName)}</b><br/><small>{record.positionTitle || "Посаду не вказано"}</small></td>
          <td>{record.militaryRank || "—"}<br/><small>{record.accountEmail ? "Є обліковий запис" : "Без облікового запису"}</small></td>
          <td><b>{vlkLabel(record.vlkDecisionCode)}</b><br/><small>{record.vlkValidUntil ? `до ${record.vlkValidUntil}` : "—"}</small></td>
          <td><span className={`statusPill ${record.active ? "ok" : ""}`}>{record.active ? "Працює" : "Архів"}</span></td>
          <td><button className="button secondary" type="button" onClick={() => startEdit(record.id)}>Картка</button></td>
        </tr>)}</tbody>
      </table>{!filtered.length && <p className="notice">Працівників за цим фільтром немає.</p>}</div>}
    </section>

    {showEditor && <>
      <section className="financeJournal">
        <header className="financeToolbar"><div><b>{editorRecord ? `Картка · ${editorRecord.displayName}` : "Новий працівник"}</b><small>Особистість працівника зберігається окремо від логіна. Посади та графіки нижче мають власну історію.</small></div><button className="button secondary" type="button" onClick={closeEditor}>Закрити</button></header>
        <form key={editorRecord?.id || "new"} className="formGrid" onSubmit={save}>
          <label>Прізвище<input name="lastName" defaultValue={editorRecord?.lastName || ""} required /></label>
          <label>Ім’я<input name="firstName" defaultValue={editorRecord?.firstName || ""} required /></label>
          <label>По батькові<input name="patronymic" defaultValue={editorRecord?.patronymic || ""} /></label>
          <label>Дата народження<input name="dateOfBirth" type="date" defaultValue={editorRecord?.dateOfBirth || ""} /></label>
          <label>Табельний / службовий №<input name="staffNumber" defaultValue={editorRecord?.staffNumber || ""} /></label>
          <label>Категорія персоналу<select name="employmentKind" defaultValue={editorRecord?.employmentKind || "unspecified"}>{EMPLOYMENT.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Основний підрозділ<select name="departmentId" defaultValue={editorRecord?.departmentId || ""}><option value="">Не вказано</option>{(data?.departments || []).map((department) => <option key={department.id} value={department.id}>{hierarchyLabel(department.id, department.name)}</option>)}</select></label>
          <label>Основна посада<input name="positionTitle" list="personnel-position-options" defaultValue={editorRecord?.positionTitle || ""} required /><datalist id="personnel-position-options">{POSITIONS.map((value) => <option key={value} value={value}/>)}</datalist></label>
          <label>Військове звання<input name="militaryRank" list="personnel-rank-options" defaultValue={editorRecord?.militaryRank || ""} /><datalist id="personnel-rank-options">{RANKS.map((value) => <option key={value} value={value}/>)}</datalist></label>
          <label>Обліковий запис RadiologyOS<select name="accountEmail" defaultValue={editorRecord?.accountEmail || ""}><option value="">Без облікового запису</option>{(data?.accounts || []).map((account) => <option key={account.email} value={account.email} disabled={linkedAccounts.has(account.email)}>{account.displayName || account.phone || account.email}{linkedAccounts.has(account.email) ? " · вже пов’язаний" : ""}</option>)}</select></label>
          <label>Робочий телефон<input name="workPhone" inputMode="tel" defaultValue={editorRecord?.workPhone || ""} /></label>
          <label>Особистий телефон<input name="personalPhone" inputMode="tel" defaultValue={editorRecord?.personalPhone || ""} /></label>
          <label>Робочий e-mail<input name="workEmail" type="email" defaultValue={editorRecord?.workEmail || ""} /></label>
          <label>Додатковий e-mail<input name="alternateEmail" type="email" defaultValue={editorRecord?.alternateEmail || ""} /></label>
          <label>Область<input name="region" defaultValue={editorRecord?.region || ""} /></label>
          <label>Населений пункт<input name="city" defaultValue={editorRecord?.city || ""} /></label>
          <label>Адреса<input name="addressLine" defaultValue={editorRecord?.addressLine || ""} placeholder="Вулиця, будинок, квартира" /></label>
          <label>Поштовий індекс<input name="postalCode" inputMode="numeric" defaultValue={editorRecord?.postalCode || ""} /></label>
          <label><span>Статус</span><span><input name="active" type="checkbox" defaultChecked={editorRecord ? Boolean(editorRecord.active) : true} /> Активний працівник</span></label>
          <div><button className="button primary" type="submit" disabled={saving}>{saving ? "Зберігаємо…" : "Зберегти картку"}</button></div>
        </form>
      </section>

      {editorRecord && <>
        <section className="financeJournal">
          <header className="financeToolbar"><div><b>Призначення і посадові обов’язки</b><small>Основна, додаткова або тимчасово виконувана посада з датами та підставою. Працівник не дублюється.</small></div><button className="button primary" type="button" onClick={newAssignment}>+ Призначення</button></header>
          <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Посада</th><th>Структура</th><th>Період</th><th>Обов’язки / підстава</th><th/></tr></thead><tbody>
            {selectedAssignments.map((row) => <tr key={row.id}><td><b>{row.positionTitle}</b><br/><small>{assignmentKindLabel(row.assignmentKind)}</small></td><td>{row.parentDepartmentName ? `${row.parentDepartmentName} → ` : ""}{row.departmentName || "Без підрозділу"}</td><td>{row.startsOn || "—"} → {row.endsOn || "дотепер"}</td><td><small>{row.duties || "Обов’язки не внесено"}{row.orderReference ? ` · ${row.orderReference}` : ""}</small></td><td><button className="button secondary" type="button" onClick={() => editAssignment(row)}>Змінити</button></td></tr>)}
          </tbody></table>{!selectedAssignments.length && <p className="notice">Призначень ще немає.</p>}</div>
          {showAssignmentForm && <form key={assignmentEditor?.id || "new-assignment"} className="formGrid" onSubmit={saveAssignment}>
            <label>Тип призначення<select name="assignmentKind" defaultValue={assignmentEditor?.assignmentKind || "secondary"}>{ASSIGNMENT_KINDS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Підрозділ<select name="assignmentDepartmentId" defaultValue={assignmentEditor?.departmentId || editorRecord.departmentId || ""}><option value="">Не вказано</option>{(data?.departments || []).map((department) => <option key={department.id} value={department.id}>{hierarchyLabel(department.id, department.name)}</option>)}</select></label>
            <label>Посада<input name="assignmentPositionTitle" list="personnel-position-options" defaultValue={assignmentEditor?.positionTitle || ""} required /></label>
            <label>Початок<input name="startsOn" type="date" defaultValue={assignmentEditor?.startsOn || ""} /></label>
            <label>Завершення<input name="endsOn" type="date" defaultValue={assignmentEditor?.endsOn || ""} /></label>
            <label>Наказ / підстава<input name="orderReference" defaultValue={assignmentEditor?.orderReference || ""} placeholder="№, дата або коротка підстава" /></label>
            <label style={{gridColumn:"1 / -1"}}>Посадові обов’язки<textarea name="duties" rows={5} defaultValue={assignmentEditor?.duties || ""} placeholder="Функції та відповідальність за цією посадою" /></label>
            <div className="shiftPlannerActions"><button className="button primary" disabled={saving} type="submit">{saving ? "Зберігаємо…" : "Зберегти призначення"}</button><button className="button secondary" type="button" onClick={() => {setShowAssignmentForm(false);setAssignmentEditor(null);}}>Скасувати</button></div>
          </form>}
        </section>

        <section className="financeJournal">
          <header className="financeToolbar"><div><b>Графік роботи</b><small>Нормативний тижневий режим працівника. Чергування, нічні та добові зміни ведуться окремо в «Графіку змін».</small></div><button className="button primary" type="button" onClick={newSchedule}>+ Графік роботи</button></header>
          {currentSchedule ? <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Назва</th><th>Тип</th><th>Період</th><th>Норма</th><th/></tr></thead><tbody>{selectedSchedules.map((row) => <tr key={row.id}><td><b>{row.name}</b>{row.note && <><br/><small>{row.note}</small></>}</td><td>{scheduleKindLabel(row.scheduleKind)}</td><td>{row.validFrom} → {row.validTo || "дотепер"}</td><td>{hoursLabel(row.weeklyMinutes)} / тиждень</td><td><button className="button secondary" type="button" onClick={() => editSchedule(row)}>Змінити</button></td></tr>)}</tbody></table></div> : <p className="notice">Базовий графік роботи ще не задано. Це не заважає вести окремий графік чергувань.</p>}
          {showScheduleForm && <form key={scheduleEditor?.id || "new-schedule"} onSubmit={saveSchedule}>
            <div className="formGrid">
              <label>Назва<input name="scheduleName" defaultValue={scheduleEditor?.name || ""} placeholder="Напр. Основний робочий графік" required /></label>
              <label>Тип<select name="scheduleKind" defaultValue={scheduleEditor?.scheduleKind || "individual"}>{SCHEDULE_KINDS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Діє з<input name="validFrom" type="date" defaultValue={scheduleEditor?.validFrom || new Date().toISOString().slice(0,10)} required /></label>
              <label>Діє до<input name="validTo" type="date" defaultValue={scheduleEditor?.validTo || ""} /></label>
              <label style={{gridColumn:"1 / -1"}}>Примітка<input name="scheduleNote" defaultValue={scheduleEditor?.note || ""} placeholder="Необов’язково" /></label>
              <label><span>Стан</span><span><input name="scheduleActive" type="checkbox" defaultChecked={scheduleEditor ? Boolean(scheduleEditor.active) : true} /> Активний графік</span></label>
            </div>
            <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>День</th><th>Робочий</th><th>Початок</th><th>Кінець</th><th>Перерва з</th><th>Перерва до</th></tr></thead><tbody>{scheduleDays.map((day) => <tr key={day.weekday}><td><b>{WEEKDAYS[day.weekday - 1]}</b></td><td><input aria-label={`${WEEKDAYS[day.weekday - 1]} робочий`} type="checkbox" checked={day.isWorking} onChange={(event) => updateDay(day.weekday, event.target.checked ? {isWorking:true} : {isWorking:false,startTime:"",endTime:"",breakStart:"",breakEnd:""})} /></td><td><input aria-label={`${WEEKDAYS[day.weekday - 1]} початок`} type="time" disabled={!day.isWorking} value={day.startTime} onChange={(event) => updateDay(day.weekday,{startTime:event.target.value})} /></td><td><input aria-label={`${WEEKDAYS[day.weekday - 1]} кінець`} type="time" disabled={!day.isWorking} value={day.endTime} onChange={(event) => updateDay(day.weekday,{endTime:event.target.value})} /></td><td><input aria-label={`${WEEKDAYS[day.weekday - 1]} перерва з`} type="time" disabled={!day.isWorking} value={day.breakStart} onChange={(event) => updateDay(day.weekday,{breakStart:event.target.value})} /></td><td><input aria-label={`${WEEKDAYS[day.weekday - 1]} перерва до`} type="time" disabled={!day.isWorking} value={day.breakEnd} onChange={(event) => updateDay(day.weekday,{breakEnd:event.target.value})} /></td></tr>)}</tbody></table></div>
            <div className="shiftPlannerActions"><button className="button primary" disabled={saving} type="submit">{saving ? "Зберігаємо…" : "Зберегти графік роботи"}</button><button className="button secondary" type="button" onClick={() => {setShowScheduleForm(false);setScheduleEditor(null);}}>Скасувати</button></div>
          </form>}
        </section>

        <section className="financeJournal">
          <header className="financeToolbar"><div><b>ВЛК, ДІВ та кадрові допуски</b><small>Окремі захищені реєстри використовують той самий personnelId.</small></div></header>
          <div className="shiftPlannerActions">
            <Link className="button secondary" href={`/staff/personnel/vlk?personnelId=${encodeURIComponent(editorRecord.id)}`}>ВЛК · {vlkLabel(editorRecord.vlkDecisionCode)}</Link>
            <Link className="button secondary" href={`/staff/personnel/radiation-clearance?personnelId=${encodeURIComponent(editorRecord.id)}`}>Допуск до ДІВ</Link>
            <Link className="button secondary" href={`/staff/personnel/radiation-training?personnelId=${encodeURIComponent(editorRecord.id)}`}>Навчання</Link>
            <Link className="button secondary" href={`/staff/personnel/dosimetry?personnelId=${encodeURIComponent(editorRecord.id)}`}>Дозиметрія</Link>
            <Link className="button secondary" href="/staff/shifts">Чергування / зміни</Link>
          </div>
          <p className="notice">Файли кадрових документів не зберігаються в D1. Для них потрібен окремий приватний файловий контур з контрольованим завантаженням і видачею.</p>
        </section>
      </>}
    </>}
  </StaffWorkspaceShell>;
}