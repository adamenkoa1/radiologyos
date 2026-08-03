"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { SERVICES } from "../../../lib/catalog";
import { SERVICE_CONFIG_DEFAULTS, type ServiceConfigRecord } from "../../../lib/service-config";
import { countUk, roleLabelUk } from "../../../lib/labels";

type StaffInfo = { email: string; displayName: string; role: string };
const CABINETS = {
  xray: "Кабінет цифрової рентгенографії",
  fluoro: "Кабінет цифрової флюорографії",
  ct: "Кабінет комп’ютерної томографії",
} as const;

export default function ServiceAssignmentsPage() {
  const [services, setServices] = useState<ServiceConfigRecord[]>(SERVICE_CONFIG_DEFAULTS.map((row) => ({ ...row })));
  const [staff, setStaff] = useState<StaffInfo>();
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/staff/services", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) setError(data.error || "Не вдалося завантажити послуги");
        else {
          if (Array.isArray(data.services)) setServices(data.services);
          if (data.staff) setStaff(data.staff);
        }
        setLoaded(true);
      })
      .catch(() => { if (active) { setError("Не вдалося завантажити послуги — перевірте зʼєднання"); setLoaded(true); } });
    return () => { active = false; };
  }, []);

  const canEdit = staff?.role === "admin";

  const grouped = useMemo(() => Object.keys(CABINETS).map((equipmentId) => ({
    equipmentId,
    rows: services.filter((row) => row.equipmentId === equipmentId),
  })), [services]);

  function change(code: string, field: keyof ServiceConfigRecord, value: string | boolean) {
    setServices((rows) => rows.map((row) => row.code === code
      ? ({ ...row, [field]: field === "durationMinutes" ? Number(value) : value } as ServiceConfigRecord)
      : row));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(""); setError("");
    const response = await fetch("/api/staff/services", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ services }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Не вдалося зберегти"); return; }
    if (Array.isArray(data.services)) setServices(data.services);
    setNotice("Прив’язки послуг збережено.");
  }

  return <StaffWorkspaceShell active="services" title="Послуги кабінетів" description="Кабінет, тривалість, доступність і правила запису для кожного дослідження." staffName={staff?.displayName} staffRole={roleLabelUk(staff?.role)}>
    {!loaded ? <p className="notice">Завантаження…</p> : <form className="equipmentRegistry" onSubmit={save}>
      <div className="equipmentRegistryHead">
        <div><b>Кабінет → обладнання → послуги</b><span>Неактивні послуги не приймаються сервером і не створюють слоти.</span></div>
        <a href="/staff/schedule">Графік кабінетів →</a>
      </div>
      <fieldset className="equipmentRegistryGrid" disabled={!canEdit}>
        {grouped.map((group, index) => <details className="equipmentCard" key={group.equipmentId} open={index === 0 && group.rows.length > 0}>
          <summary><i>{String(index + 1).padStart(2, "0")}</i><span><b>{CABINETS[group.equipmentId as keyof typeof CABINETS]}</b><small>{countUk(group.rows.length, "послуга", "послуги", "послуг")}</small></span><em className="active">Налаштування</em></summary>
          <div className="equipmentFields">
            {group.rows.length === 0 ? <p className="settingsHint">До цього кабінету не привʼязано жодної послуги.</p> : group.rows.map((row) => {
              const service = SERVICES.find((item) => item.code === row.code);
              if (!service) return null;
              return <div className="serviceAssignmentRow" key={row.code}>
                <div><b>{row.code} · {service.title}</b><small>{service.group}</small></div>
                <label><span>Кабінет</span><select value={row.equipmentId} onChange={(event) => change(row.code, "equipmentId", event.target.value)}>
                  {Object.entries(CABINETS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select></label>
                <label><span>Тривалість, хв</span><input type="number" min={5} max={360} step={5} value={row.durationMinutes} onChange={(event) => change(row.code, "durationMinutes", event.target.value)} /></label>
                <label><span>Стан</span><select value={row.active ? "active" : "inactive"} onChange={(event) => change(row.code, "active", event.target.value === "active")}><option value="active">Активна</option><option value="inactive">Вимкнена</option></select></label>
                <label><span>Військовим</span><select value={row.military ? "yes" : "no"} onChange={(event) => change(row.code, "military", event.target.value === "yes")}><option value="yes">Доступна</option><option value="no">Недоступна</option></select></label>
                <label><span>Цивільним</span><select value={row.civilian ? "yes" : "no"} onChange={(event) => change(row.code, "civilian", event.target.value === "yes")}><option value="yes">Доступна</option><option value="no">Недоступна</option></select></label>
                <label><span>Попередній запис</span><select value={row.requiresBooking ? "yes" : "no"} onChange={(event) => change(row.code, "requiresBooking", event.target.value === "yes")}><option value="yes">Потрібен</option><option value="no">Жива черга</option></select></label>
              </div>;
            })}
          </div>
        </details>)}
      </fieldset>
      {error && <p className="notice error">{error}</p>}
      {notice && <p className="notice success">{notice}</p>}
      {canEdit ? <button className="equipmentSave" type="submit">Зберегти послуги</button> : <p className="settingsHint">Перегляд доступний персоналу; редагування — адміністратору.</p>}
    </form>}
  </StaffWorkspaceShell>;
}
