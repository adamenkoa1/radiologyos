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
  active:number; createdAt:string; updatedAt:string;
};
type Department = { id:number; name:string; active:number };
type Account = { email:string; displayName:string; phone:string; role:string; active:number };
type ApiData = { records:PersonnelRecord[]; departments:Department[]; accounts:Account[]; error?:string };

const EMPLOYMENT = [
  ["unspecified", "Не визначено"],
  ["military", "Військовослужбовець"],
  ["civilian", "Працівник ЗСУ / цивільний"],
  ["contractor", "Сумісник / контрактний"],
  ["other", "Інше"],
] as const;
const POSITIONS = [
  "Начальник відділення променевої діагностики",
  "Лікар-рентгенолог",
  "Рентгенолаборант",
  "Молодша медична сестра",
  "Начальник ПРК",
  "Рентгенолаборант ПРК",
  "Водій ПРК",
  "Начальник кабінету УЗД",
  "Лікар ультразвукової діагностики",
];
const RANKS = [
  "Цивільний персонал", "Солдат", "Старший солдат", "Молодший сержант", "Сержант",
  "Старший сержант", "Головний сержант", "Штаб-сержант", "Молодший лейтенант",
  "Лейтенант", "Старший лейтенант", "Капітан", "Майор", "Підполковник", "Полковник",
];

function initials(record:PersonnelRecord) {
  return `${record.firstName?.[0] || ""}${record.lastName?.[0] || ""}`.toUpperCase() || "?";
}

function employmentLabel(value:string) {
  return EMPLOYMENT.find(([key]) => key === value)?.[1] || value || "Не визначено";
}

export default function PersonnelPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  const load = useCallback(async (preferredId?:string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/staff/personnel", { cache:"no-store" });
      const body = await response.json().catch(() => ({})) as Partial<ApiData>;
      if (!response.ok) throw new Error(body.error || "Не вдалося завантажити персонал");
      const next = {
        records: body.records || [], departments: body.departments || [], accounts: body.accounts || [],
      } as ApiData;
      setData(next);
      if (preferredId && next.records.some((record) => record.id === preferredId)) setSelectedId(preferredId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити персонал");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selected = useMemo(
    () => data?.records.find((record) => record.id === selectedId) || null,
    [data, selectedId],
  );
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
  }
  function startEdit(id:string) {
    setCreating(false); setSelectedId(id); setNotice(""); setError("");
  }
  function closeEditor() {
    setCreating(false); setSelectedId(""); setError("");
  }

  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      id: selected?.id,
      accountEmail: String(form.get("accountEmail") || "") || null,
      staffNumber: String(form.get("staffNumber") || ""),
      employmentKind: String(form.get("employmentKind") || "unspecified"),
      lastName: String(form.get("lastName") || ""),
      firstName: String(form.get("firstName") || ""),
      patronymic: String(form.get("patronymic") || ""),
      dateOfBirth: String(form.get("dateOfBirth") || ""),
      militaryRank: String(form.get("militaryRank") || ""),
      positionTitle: String(form.get("positionTitle") || ""),
      departmentId: String(form.get("departmentId") || "") || null,
      workPhone: String(form.get("workPhone") || ""),
      personalPhone: String(form.get("personalPhone") || ""),
      workEmail: String(form.get("workEmail") || ""),
      alternateEmail: String(form.get("alternateEmail") || ""),
      region: String(form.get("region") || ""),
      city: String(form.get("city") || ""),
      addressLine: String(form.get("addressLine") || ""),
      postalCode: String(form.get("postalCode") || ""),
      active: form.get("active") === "on",
    };
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/staff/personnel", {
        method: selected ? "PATCH" : "POST",
        headers: { "content-type":"application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { ok?:boolean; id?:string; error?:string };
      if (!response.ok || !body.ok || !body.id) throw new Error(body.error || "Не вдалося зберегти картку");
      await load(body.id);
      setCreating(false);
      setSelectedId(body.id);
      setNotice(selected ? "Картку працівника оновлено." : "Працівника додано до кадрового довідника.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти картку");
    } finally {
      setSaving(false);
    }
  }

  const editorRecord = selected;
  const showEditor = creating || Boolean(editorRecord);

  return <StaffWorkspaceShell
    active="directories"
    title="Персонал"
    description="Кадровий довідник працівників. Картка працівника відокремлена від облікового запису RadiologyOS."
  >
    <section className="financeSummary" aria-label="Стан кадрового довідника">
      <article><span>Працівники</span><b>{data?.records.filter((record) => record.active).length || 0}</b><small>активні картки</small></article>
      <article><span>Підрозділи</span><b>{data?.departments.length || 0}</b><small>доступні у структурі</small></article>
      <article><span>З акаунтом</span><b>{data?.records.filter((record) => record.accountEmail).length || 0}</b><small>мають вхід у RadiologyOS</small></article>
      <article><span>Графіки</span><b>Calendar6</b><small><Link href="/staff/shifts">відкрити графік змін</Link></small></article>
    </section>

    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}

    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Зведений реєстр персоналу</b><small>ПІБ, підрозділ, посада й робочі контакти. ВЛК, ДІВ, навчання та документи підключаються наступними кадровими блоками.</small></div>
        <div className="shiftPlannerActions"><button className="button primary" type="button" onClick={startCreate}>+ Додати працівника</button></div>
      </header>
      <div className="shiftPlannerToolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук за ПІБ, посадою, телефоном…" aria-label="Пошук персоналу" />
        <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} aria-label="Фільтр підрозділу">
          <option value="all">Усі підрозділи</option>
          {(data?.departments || []).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select>
      </div>
      {loading ? <p className="notice">Завантаження персоналу…</p> : <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Працівник</th><th>Підрозділ / посада</th><th>Службові дані</th><th>Контакти</th><th>Статус</th><th/></tr></thead>
        <tbody>{filtered.map((record) => <tr key={record.id}>
          <td><div style={{display:"flex",alignItems:"center",gap:8}}><span className="statusPill">{initials(record)}</span><div><b>{record.displayName}</b><br/><small>{record.staffNumber ? `Таб. № ${record.staffNumber}` : employmentLabel(record.employmentKind)}</small></div></div></td>
          <td><b>{record.departmentName || "Підрозділ не вказано"}</b><br/><small>{record.positionTitle}</small></td>
          <td>{record.militaryRank || "—"}<br/><small>{record.dateOfBirth || "Дата народження не вказана"}</small></td>
          <td>
            {record.workPhone ? <><a href={`tel:${record.workPhone}`}>{record.workPhone}</a><br/></> : null}
            {record.workEmail ? <a href={`mailto:${record.workEmail}`}>{record.workEmail}</a> : (!record.workPhone ? "—" : null)}
          </td>
          <td><span className={`statusPill ${record.active ? "ok" : ""}`}>{record.active ? "Працює" : "Архів"}</span></td>
          <td><button className="button secondary" type="button" onClick={() => startEdit(record.id)}>Картка</button></td>
        </tr>)}</tbody>
      </table>{!filtered.length && <p className="notice">Працівників за цим фільтром немає.</p>}</div>}
    </section>

    {showEditor && <section className="financeJournal">
      <header className="financeToolbar"><div><b>{editorRecord ? `Картка · ${editorRecord.displayName}` : "Новий працівник"}</b><small>Контактні та кадрові дані не змінюють логін/PIN працівника.</small></div><button className="button secondary" type="button" onClick={closeEditor}>Закрити</button></header>
      <form key={editorRecord?.id || "new"} className="formGrid" onSubmit={save}>
        <label>Прізвище<input name="lastName" defaultValue={editorRecord?.lastName || ""} required /></label>
        <label>Ім’я<input name="firstName" defaultValue={editorRecord?.firstName || ""} required /></label>
        <label>По батькові<input name="patronymic" defaultValue={editorRecord?.patronymic || ""} /></label>
        <label>Дата народження<input name="dateOfBirth" type="date" defaultValue={editorRecord?.dateOfBirth || ""} /></label>
        <label>Табельний / службовий №<input name="staffNumber" defaultValue={editorRecord?.staffNumber || ""} /></label>
        <label>Категорія персоналу<select name="employmentKind" defaultValue={editorRecord?.employmentKind || "unspecified"}>{EMPLOYMENT.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Підрозділ<select name="departmentId" defaultValue={editorRecord?.departmentId || ""}><option value="">Не вказано</option>{(data?.departments || []).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
        <label>Посада<input name="positionTitle" list="personnel-position-options" defaultValue={editorRecord?.positionTitle || ""} required /><datalist id="personnel-position-options">{POSITIONS.map((value) => <option key={value} value={value}/>)}</datalist></label>
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
      <p className="notice">Фото, дипломи, сертифікати, ВЛК, допуск до ДІВ і навчання будуть окремими захищеними вкладками цієї ж картки — без зберігання файлів у D1.</p>
    </section>}
  </StaffWorkspaceShell>;
}
