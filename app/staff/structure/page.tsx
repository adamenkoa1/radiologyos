"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import {
  cloneDepartmentStructure,
  type DepartmentStructure,
  totalStudies2025,
} from "../../../lib/department-structure";
import { SITE_CONTENT_DEFAULTS, type SiteContent } from "../../../lib/site-content";

type StaffInfo = { email: string; displayName: string; role: string };

const formatNumber = (value: number) => new Intl.NumberFormat("uk-UA").format(value);

export default function StructurePage() {
  const [structure, setStructure] = useState<DepartmentStructure>(cloneDepartmentStructure());
  const [siteContent, setSiteContent] = useState<SiteContent>({ ...SITE_CONTENT_DEFAULTS });
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/staff/structure", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          if (active) setForbidden(true);
          return;
        }
        const data = await res.json().catch(() => ({})) as {
          structure?: DepartmentStructure;
          siteContent?: SiteContent;
          staff?: StaffInfo;
          canEdit?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Не вдалося завантажити структуру");
        if (!active) return;
        if (data.structure) setStructure(data.structure);
        if (data.siteContent) setSiteContent({ ...SITE_CONTENT_DEFAULTS, ...data.siteContent });
        setStaff(data.staff ?? null);
        setCanEdit(Boolean(data.canEdit));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Не вдалося завантажити структуру");
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  function updateSite(key: keyof SiteContent, value: string | boolean) {
    setSiteContent(prev => ({ ...prev, [key]: value }));
  }

  function updateHospital(key: keyof DepartmentStructure["hospital"], value: string) {
    setStructure(prev => ({ ...prev, hospital: { ...prev.hospital, [key]: value } }));
  }

  function updateLicense(key: keyof DepartmentStructure["license"], value: string) {
    setStructure(prev => ({ ...prev, license: { ...prev.license, [key]: value } }));
  }

  function updateDepartment(key: keyof DepartmentStructure["department"], value: string) {
    setStructure(prev => ({ ...prev, department: { ...prev.department, [key]: value } }));
  }

  function updateStats(key: "title" | "complexShare" | "militaryExamined", value: string) {
    setStructure(prev => ({
      ...prev,
      statistics2025: {
        ...prev.statistics2025,
        [key]: key === "title" ? value : Number(value),
      },
    }));
  }

  function updateMetric(index: number, key: "label" | "value", value: string) {
    setStructure(prev => ({
      ...prev,
      statistics2025: {
        ...prev.statistics2025,
        breakdown: prev.statistics2025.breakdown.map((item, i) => i === index
          ? { ...item, [key]: key === "value" ? Number(value) : value }
          : item),
      },
    }));
  }

  function updateRoom(roomIndex: number, value: string) {
    setStructure(prev => ({ ...prev, rooms: prev.rooms.map((room, i) => i === roomIndex ? { ...room, name: value } : room) }));
  }

  function updateDevice(roomIndex: number, deviceIndex: number, key: "name" | "kind" | "details", value: string) {
    setStructure(prev => ({
      ...prev,
      rooms: prev.rooms.map((room, ri) => ri === roomIndex
        ? { ...room, devices: room.devices.map((device, di) => di === deviceIndex ? { ...device, [key]: value } : device) }
        : room),
    }));
  }

  function updatePersonnel(index: number, key: "position" | "note", value: string) {
    setStructure(prev => ({ ...prev, personnel: prev.personnel.map((item, i) => i === index ? { ...item, [key]: value } : item) }));
  }

  function updateHours(kind: "outpatient" | "inpatient", rowIndex: number, key: "service" | "intake" | "issue", value: string) {
    setStructure(prev => ({
      ...prev,
      hours: {
        ...prev.hours,
        [kind]: {
          ...prev.hours[kind],
          rows: prev.hours[kind].rows.map((row, i) => i === rowIndex ? { ...row, [key]: value } : row),
        },
      },
    }));
  }

  async function onLogoFile(file: File | null) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Оберіть файл зображення."); return; }
    try {
      if (file.type === "image/svg+xml") {
        const uri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        if (uri.length > 300000) throw new Error("SVG завеликий — спростіть логотип.");
        updateSite("logoUrl", uri);
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const image = new window.Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = objectUrl; });
      const scale = Math.min(1, 240 / image.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      let uri = canvas.toDataURL("image/webp", 0.85);
      if (uri.length > 300000) uri = canvas.toDataURL("image/jpeg", 0.72);
      if (uri.length > 300000) throw new Error("Логотип завеликий — оберіть менше зображення.");
      updateSite("logoUrl", uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося прочитати зображення.");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setNotice(""); setError("");
    try {
      const res = await fetch("/api/staff/structure", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ structure, siteContent }),
      });
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean;
        structure?: DepartmentStructure;
        siteContent?: SiteContent;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти");
      if (data.structure) setStructure(data.structure);
      if (data.siteContent) setSiteContent(data.siteContent);
      setEditing(false);
      setNotice("Зміни збережено. Публічна сторінка оновиться протягом хвилини.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  }

  const total = totalStudies2025(structure);

  const view = <div className="structTree">
    <section className="structNode structBrandNode">
      <div className="structBrandLogo">
        <Image src={siteContent.logoUrl || "/hospital-emblem.jpg"} alt="Герб Чернігівського військового госпіталю" width={110} height={110} unoptimized />
      </div>
      <div>
        <span className="structTag">Публічний сайт</span>
        <h2>{siteContent.brandTitle}</h2>
        <p>{siteContent.brandSubtitle}</p>
        <strong className="structSlogan">{siteContent.slogan}</strong>
      </div>
    </section>

    <section className="structNode structStatsNode">
      <span className="structTag">Підсумки 2025</span>
      <div className="structStatsHeadline">
        <strong>{formatNumber(total)}</strong>
        <div><h2>{structure.statistics2025.title}</h2><p>За даними пояснювальної записки відділення</p></div>
      </div>
      <div className="structStatsGrid">
        {structure.statistics2025.breakdown.map(item => <div key={item.id}><strong>{formatNumber(item.value)}</strong><span>{item.label}</span></div>)}
      </div>
      <p className="structStatsFoot"><b>{structure.statistics2025.complexShare}%</b> — складні дослідження · <b>{formatNumber(structure.statistics2025.militaryExamined)}</b> учасників АТО обстежено</p>
    </section>

    <section className="structNode structHospital">
      <span className="structTag">Госпіталь</span>
      <h2>{structure.hospital.name}</h2>
      <p>{structure.hospital.unit} · ЄДРПОУ {structure.hospital.edrpou}</p>
      <p className="structAddr">{structure.hospital.address}</p>
    </section>

    <section className="structNode structLicense">
      <span className="structTag">Ліцензія</span>
      <h3>{structure.license.number} <small>({structure.license.series})</small></h3>
      <p>{structure.license.activity}</p>
      <dl className="structMeta">
        <div><dt>Орган</dt><dd>{structure.license.authority}</dd></div>
        <div><dt>Видана</dt><dd>{structure.license.issued}</dd></div>
        <div><dt>Дійсна до</dt><dd className="structAccent">{structure.license.validUntil}</dd></div>
        <div><dt>Зміни</dt><dd>{structure.license.changes}</dd></div>
      </dl>
    </section>

    <section className="structNode structDept">
      <span className="structTag">Відділення</span>
      <h3>{structure.department.name}</h3>
      <p>{structure.department.about}</p>
      <p className="structEmergency">🕓 {structure.department.emergency}</p>
    </section>

    <section className="structNode">
      <span className="structTag">Кабінети й обладнання</span>
      <div className="structRooms">
        {structure.rooms.map(room => <article className="structRoom" key={room.id}>
          <h4>{room.name}<span className="structCount">{room.devices.length}</span></h4>
          <ul>{room.devices.map((device, index) => <li key={`${room.id}-${index}`}>
            <b>{device.name}</b>
            <span className="structDevMeta"><span className={`structKind k-${device.status === "stored" ? "stored" : room.id}`}>{device.kind}</span>{device.details}</span>
          </li>)}</ul>
        </article>)}
      </div>
    </section>

    <section className="structNode">
      <span className="structTag">Персонал (штат)</span>
      <p className="structHint">Лише посади. Облікові записи працівників ведуться окремо в «Доступі персоналу».</p>
      <ul className="structStaff">{structure.personnel.map((item, index) => <li key={index}><b>{item.position}</b>{item.note ? <small>{item.note}</small> : null}</li>)}</ul>
    </section>

    <section className="structNode">
      <span className="structTag">Режим роботи</span>
      <div className="structHours">{(["outpatient", "inpatient"] as const).map(kind => {
        const block = structure.hours[kind];
        return <article key={kind}><h4>{block.title}</h4><table><tbody>{block.rows.map((row, index) => <tr key={index}>
          <th>{row.service}</th><td>{row.intake}{row.issue ? <small>{row.issue}</small> : null}</td>
        </tr>)}</tbody></table></article>;
      })}</div>
      <p className="structEmergency">🕓 {structure.department.emergency}</p>
    </section>
  </div>;

  const editor = <form className="settingsCard structureEditor" onSubmit={save}>
    <section className="settingsBlock">
      <h3>Логотип і тексти головної</h3>
      <p className="settingsHint">Ці поля керують публічною головною сторінкою та редагуються тут без окремого блоку оформлення.</p>
      <label className="settingsField"><span>Логотип</span>
        <span className="logoPreview"><Image src={siteContent.logoUrl || "/hospital-emblem.jpg"} alt="Логотип" width={96} height={96} unoptimized /></span>
        <input type="file" accept="image/*" onChange={event => void onLogoFile(event.target.files?.[0] || null)} />
      </label>
      <label className="settingsField"><span>Назва закладу</span><input value={siteContent.brandTitle} onChange={event => updateSite("brandTitle", event.target.value)} /></label>
      <label className="settingsField"><span>Назва відділення</span><input value={siteContent.brandSubtitle} onChange={event => updateSite("brandSubtitle", event.target.value)} /></label>
      <label className="settingsField"><span>Слоган</span><input value={siteContent.slogan} onChange={event => updateSite("slogan", event.target.value)} /></label>
      <label className="settingsField"><span>Про клініку</span><textarea rows={5} value={siteContent.about} onChange={event => updateSite("about", event.target.value)} /></label>
      <div className="settingsColumns">
        <label className="settingsField"><span>Військовим — заголовок</span><input value={siteContent.milTitle} onChange={event => updateSite("milTitle", event.target.value)} /></label>
        <label className="settingsField"><span>Військовим — підпис</span><input value={siteContent.milSub} onChange={event => updateSite("milSub", event.target.value)} /></label>
        <label className="settingsField"><span>Цивільним — заголовок</span><input value={siteContent.civTitle} onChange={event => updateSite("civTitle", event.target.value)} /></label>
        <label className="settingsField"><span>Цивільним — підпис</span><input value={siteContent.civSub} onChange={event => updateSite("civSub", event.target.value)} /></label>
        <label className="settingsField"><span>Телефон</span><input value={siteContent.phone} onChange={event => updateSite("phone", event.target.value)} /></label>
        <label className="settingsField"><span>Адреса</span><input value={siteContent.address} onChange={event => updateSite("address", event.target.value)} /></label>
        <label className="settingsField"><span>Години роботи</span><input value={siteContent.workHours} onChange={event => updateSite("workHours", event.target.value)} /></label>
      </div>
    </section>

    <section className="settingsBlock">
      <h3>Показники 2025 року</h3>
      <p className="structureTotalEdit">Автоматичний підсумок: <b>{formatNumber(total)}</b></p>
      <label className="settingsField"><span>Заголовок</span><input value={structure.statistics2025.title} onChange={event => updateStats("title", event.target.value)} /></label>
      <div className="settingsColumns">{structure.statistics2025.breakdown.map((item, index) => <div className="metricEditor" key={item.id}>
        <label className="settingsField"><span>Назва показника</span><input value={item.label} onChange={event => updateMetric(index, "label", event.target.value)} /></label>
        <label className="settingsField"><span>Кількість</span><input type="number" min="0" value={item.value} onChange={event => updateMetric(index, "value", event.target.value)} /></label>
      </div>)}</div>
      <div className="settingsColumns">
        <label className="settingsField"><span>Складні дослідження, %</span><input type="number" min="0" max="100" value={structure.statistics2025.complexShare} onChange={event => updateStats("complexShare", event.target.value)} /></label>
        <label className="settingsField"><span>Обстежено учасників АТО</span><input type="number" min="0" value={structure.statistics2025.militaryExamined} onChange={event => updateStats("militaryExamined", event.target.value)} /></label>
      </div>
    </section>

    <section className="settingsBlock">
      <h3>Госпіталь і відділення</h3>
      <div className="settingsColumns">
        {(Object.keys(structure.hospital) as Array<keyof DepartmentStructure["hospital"]>).map(key => <label className="settingsField" key={key}><span>{({ name: "Назва госпіталю", unit: "Військова частина", address: "Адреса", edrpou: "ЄДРПОУ" } as const)[key]}</span><input value={structure.hospital[key]} onChange={event => updateHospital(key, event.target.value)} /></label>)}
      </div>
      <label className="settingsField"><span>Назва відділення</span><input value={structure.department.name} onChange={event => updateDepartment("name", event.target.value)} /></label>
      <label className="settingsField"><span>Інформація про відділення</span><textarea rows={5} value={structure.department.about} onChange={event => updateDepartment("about", event.target.value)} /></label>
      <label className="settingsField"><span>Невідкладна допомога</span><input value={structure.department.emergency} onChange={event => updateDepartment("emergency", event.target.value)} /></label>
    </section>

    <section className="settingsBlock">
      <h3>Ліцензія</h3>
      <div className="settingsColumns">{(Object.keys(structure.license) as Array<keyof DepartmentStructure["license"]>).map(key => <label className="settingsField" key={key}><span>{({ number: "Номер", series: "Серія", authority: "Орган", activity: "Діяльність", issued: "Видана", validUntil: "Дійсна до", changes: "Зміни" } as const)[key]}</span><input value={structure.license[key]} onChange={event => updateLicense(key, event.target.value)} /></label>)}</div>
    </section>

    <section className="settingsBlock">
      <h3>Кабінети й обладнання</h3>
      <div className="structureEditorRooms">{structure.rooms.map((room, roomIndex) => <article key={room.id}>
        <label className="settingsField"><span>Назва кабінету</span><input value={room.name} onChange={event => updateRoom(roomIndex, event.target.value)} /></label>
        {room.devices.map((device, deviceIndex) => <div className="deviceEditor" key={deviceIndex}>
          <label className="settingsField"><span>Обладнання</span><input value={device.name} onChange={event => updateDevice(roomIndex, deviceIndex, "name", event.target.value)} /></label>
          <label className="settingsField"><span>Тип</span><input value={device.kind} onChange={event => updateDevice(roomIndex, deviceIndex, "kind", event.target.value)} /></label>
          <label className="settingsField"><span>Примітка</span><input value={device.details ?? ""} onChange={event => updateDevice(roomIndex, deviceIndex, "details", event.target.value)} /></label>
        </div>)}
      </article>)}</div>
    </section>

    <section className="settingsBlock">
      <h3>Штат і режим роботи</h3>
      <div className="settingsColumns">{structure.personnel.map((item, index) => <div className="metricEditor" key={index}>
        <label className="settingsField"><span>Посада</span><input value={item.position} onChange={event => updatePersonnel(index, "position", event.target.value)} /></label>
        <label className="settingsField"><span>Примітка</span><input value={item.note} onChange={event => updatePersonnel(index, "note", event.target.value)} /></label>
      </div>)}</div>
      {(["outpatient", "inpatient"] as const).map(kind => <div className="hoursEditor" key={kind}><h4>{structure.hours[kind].title}</h4>{structure.hours[kind].rows.map((row, rowIndex) => <div className="deviceEditor" key={rowIndex}>
        <label className="settingsField"><span>Послуга</span><input value={row.service} onChange={event => updateHours(kind, rowIndex, "service", event.target.value)} /></label>
        <label className="settingsField"><span>Прийом</span><input value={row.intake} onChange={event => updateHours(kind, rowIndex, "intake", event.target.value)} /></label>
        <label className="settingsField"><span>Видача</span><input value={row.issue ?? ""} onChange={event => updateHours(kind, rowIndex, "issue", event.target.value)} /></label>
      </div>)}</div>)}
    </section>

    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="settingsActions">
      <button type="submit" disabled={saving}>{saving ? "Зберігаємо…" : "Зберегти зміни"}</button>
      <button type="button" className="secondaryButton" onClick={() => { setEditing(false); setNotice(""); }}>Скасувати</button>
      <a className="textLink" href="/" target="_blank" rel="noopener">Відкрити сайт ↗</a>
    </div>
  </form>;

  const body = forbidden
    ? <section className="accessDenied"><b>Захищений розділ</b><p>Структура відділення доступна лише персоналу.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fstructure">Увійти для роботи</a></section>
    : !loaded
      ? <p className="dashLoading">Завантаження…</p>
      : error && !staff
        ? <p className="notice error" role="alert">{error}</p>
        : <>
            <div className="structureToolbar">
              <div>{notice && <p className="notice success" role="status">{notice}</p>}</div>
              {canEdit && !editing ? <button type="button" onClick={() => { setEditing(true); setNotice(""); }}>Редагувати структуру</button> : null}
            </div>
            {editing ? editor : view}
          </>;

  return <StaffWorkspaceShell
    active="structure"
    title="Структура відділення"
    description="Госпіталь, контент головної, підсумки 2025 року, кабінети, обладнання, штат і режим роботи — в одному редагованому розділі."
    staffName={staff?.displayName}
    staffRole={staff?.role}
  >{body}</StaffWorkspaceShell>;
}
