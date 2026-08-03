"use client";

import { FormEvent, useEffect, useState, type CSSProperties } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import {
  cloneDepartmentStructure,
  type DepartmentStructure,
  totalStudies2025,
} from "../../../lib/department-structure";
import { SITE_CONTENT_DEFAULTS, type SiteContent } from "../../../lib/site-content";

type StaffInfo = { email: string; displayName: string; role: string };

const formatNumber = (value: number) => new Intl.NumberFormat("uk-UA").format(value);
const copyStructure = (value: DepartmentStructure) => JSON.parse(JSON.stringify(value)) as DepartmentStructure;

type InlineFieldProps = {
  value: string;
  label: string;
  className?: string;
  multiline?: boolean;
  rows?: number;
  readOnly: boolean;
  onChange: (value: string) => void;
};

function InlineField({ value, label, className = "", multiline = false, rows = 2, readOnly, onChange }: InlineFieldProps) {
  if (multiline) {
    return <textarea
      className={`sfEditable ${className}`}
      aria-label={label}
      title={readOnly ? undefined : `${label} — натисніть, щоб змінити`}
      value={value}
      rows={rows}
      readOnly={readOnly}
      onChange={event => onChange(event.target.value)}
    />;
  }
  return <input
    className={`sfEditable ${className}`}
    aria-label={label}
    title={readOnly ? undefined : `${label} — натисніть, щоб змінити`}
    value={value}
    readOnly={readOnly}
    onChange={event => onChange(event.target.value)}
  />;
}

export default function StructurePage() {
  const [structure, setStructure] = useState<DepartmentStructure>(cloneDepartmentStructure());
  const [siteContent, setSiteContent] = useState<SiteContent>({ ...SITE_CONTENT_DEFAULTS });
  const [savedStructure, setSavedStructure] = useState<DepartmentStructure>(cloneDepartmentStructure());
  const [savedSiteContent, setSavedSiteContent] = useState<SiteContent>({ ...SITE_CONTENT_DEFAULTS });
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [canEdit, setCanEdit] = useState(false);
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
        if (!res.ok) throw new Error(data.error || "Не вдалося завантажити вітрину");
        if (!active) return;
        const nextStructure = data.structure ? copyStructure(data.structure) : cloneDepartmentStructure();
        const nextContent = { ...SITE_CONTENT_DEFAULTS, ...(data.siteContent ?? {}) };
        setStructure(nextStructure);
        setSavedStructure(copyStructure(nextStructure));
        setSiteContent(nextContent);
        setSavedSiteContent({ ...nextContent });
        setStaff(data.staff ?? null);
        setCanEdit(Boolean(data.canEdit));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Не вдалося завантажити вітрину");
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  function updateSite(key: keyof SiteContent, value: string | boolean) {
    setSiteContent(prev => ({ ...prev, [key]: value }));
    setNotice("");
  }

  function updateHospital(key: keyof DepartmentStructure["hospital"], value: string) {
    setStructure(prev => ({ ...prev, hospital: { ...prev.hospital, [key]: value } }));
    setNotice("");
  }

  function updateLicense(key: keyof DepartmentStructure["license"], value: string) {
    setStructure(prev => ({ ...prev, license: { ...prev.license, [key]: value } }));
    setNotice("");
  }

  function updateDepartment(key: keyof DepartmentStructure["department"], value: string) {
    setStructure(prev => ({ ...prev, department: { ...prev.department, [key]: value } }));
    setNotice("");
  }

  function updateStats(key: "title" | "complexShare" | "militaryExamined", value: string) {
    setStructure(prev => ({
      ...prev,
      statistics2025: {
        ...prev.statistics2025,
        [key]: key === "title" ? value : Number(value),
      },
    }));
    setNotice("");
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
    setNotice("");
  }

  function updateRoom(roomIndex: number, value: string) {
    setStructure(prev => ({ ...prev, rooms: prev.rooms.map((room, i) => i === roomIndex ? { ...room, name: value } : room) }));
    setNotice("");
  }

  function updatePersonnel(index: number, key: "position" | "note", value: string) {
    setStructure(prev => ({ ...prev, personnel: prev.personnel.map((item, i) => i === index ? { ...item, [key]: value } : item) }));
    setNotice("");
  }

  function resetChanges() {
    setStructure(copyStructure(savedStructure));
    setSiteContent({ ...savedSiteContent });
    setNotice("");
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
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
      const nextStructure = data.structure ? copyStructure(data.structure) : copyStructure(structure);
      const nextContent = data.siteContent ? { ...data.siteContent } : { ...siteContent };
      setStructure(nextStructure);
      setSavedStructure(copyStructure(nextStructure));
      setSiteContent(nextContent);
      setSavedSiteContent({ ...nextContent });
      setNotice("Зміни збережено. Публічна вітрина оновиться протягом хвилини.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  }

  const total = totalStudies2025(structure);
  const readOnly = !canEdit;

  const editor = <form id="storefront-editor-form" className="storefrontEditorForm" onSubmit={save}>
    <div className="storefrontCanvas" style={{ "--sf-brand": siteContent.brandColor } as CSSProperties}>
      <section className="sfEditHeader" aria-label="Шапка публічного сайту">
        <div className="sfHeaderCopy">
          <InlineField label="Назва закладу" className="sfBrandTitle" value={siteContent.brandTitle} readOnly={readOnly} onChange={value => updateSite("brandTitle", value)} />
          <InlineField label="Назва відділення" className="sfBrandSubtitle" value={siteContent.brandSubtitle} readOnly={readOnly} onChange={value => updateSite("brandSubtitle", value)} />
          <InlineField label="Слоган" className="sfSlogan" value={siteContent.slogan} readOnly={readOnly} onChange={value => updateSite("slogan", value)} />
        </div>
        <span className="sfLoginPreview">Вхід⌄</span>
      </section>

      <section className="sfAudienceEditor" aria-label="Картки відвідувачів">
        <article className="sfAudienceCard military">
          <span className="sfAudienceIcon" aria-hidden="true">◇</span>
          <div>
            <InlineField label="Заголовок для військовослужбовців" className="sfAudienceTitle" value={siteContent.milTitle} readOnly={readOnly} onChange={value => updateSite("milTitle", value)} />
            <InlineField label="Підпис для військовослужбовців" className="sfAudienceSub" value={siteContent.milSub} readOnly={readOnly} onChange={value => updateSite("milSub", value)} />
          </div>
          <span className="sfAudienceArrow" aria-hidden="true">›</span>
        </article>

        <section className="sfHowCard militaryHow" aria-label="Порядок для військовослужбовців">
          <span className="sfKicker">Як це працює для військовослужбовців</span>
          <InlineField label="Заголовок порядку для військовослужбовців" className="sfHowTitle" value={siteContent.howTitle} readOnly={readOnly} onChange={value => updateSite("howTitle", value)} />
          <InlineField label="Вступ до порядку проходження" className="sfHowIntro" multiline rows={2} value={siteContent.howIntro} readOnly={readOnly} onChange={value => updateSite("howIntro", value)} />
          <div className="sfHowSteps">
            <article><span>1</span><div><InlineField label="Назва першого кроку" className="sfHowStepTitle" value={siteContent.howQueueTitle} readOnly={readOnly} onChange={value => updateSite("howQueueTitle", value)} /><InlineField label="Порядок живої черги" multiline rows={3} value={siteContent.howQueue} readOnly={readOnly} onChange={value => updateSite("howQueue", value)} /></div></article>
            <article><span>2</span><div><InlineField label="Назва другого кроку" className="sfHowStepTitle" value={siteContent.howFluoroTitle} readOnly={readOnly} onChange={value => updateSite("howFluoroTitle", value)} /><InlineField label="Порядок флюорографії" multiline rows={3} value={siteContent.howFluoro} readOnly={readOnly} onChange={value => updateSite("howFluoro", value)} /></div></article>
            <article><span>3</span><div><InlineField label="Назва третього кроку" className="sfHowStepTitle" value={siteContent.howXrayTitle} readOnly={readOnly} onChange={value => updateSite("howXrayTitle", value)} /><InlineField label="Порядок рентгенографії" multiline rows={3} value={siteContent.howXray} readOnly={readOnly} onChange={value => updateSite("howXray", value)} /></div></article>
          </div>
          <div className="sfHowException"><InlineField label="Назва винятків" className="sfHowStepTitle" value={siteContent.howExceptionsTitle} readOnly={readOnly} onChange={value => updateSite("howExceptionsTitle", value)} /><InlineField label="Винятки із живої черги" multiline rows={2} value={siteContent.howExceptions} readOnly={readOnly} onChange={value => updateSite("howExceptions", value)} /></div>
          <section className="sfBariumCard" aria-label="Підготовка до рентгенографії з барієм">
            <InlineField label="Заголовок блоку про барій" className="sfHowTitle" value={siteContent.bariumTitle} readOnly={readOnly} onChange={value => updateSite("bariumTitle", value)} />
            <InlineField label="Для чого проводиться" multiline rows={4} value={siteContent.bariumPurpose} readOnly={readOnly} onChange={value => updateSite("bariumPurpose", value)} />
            <InlineField label="Як підготуватися" multiline rows={6} value={siteContent.bariumPreparation} readOnly={readOnly} onChange={value => updateSite("bariumPreparation", value)} />
            <InlineField label="Як проходить дослідження" multiline rows={5} value={siteContent.bariumProcedure} readOnly={readOnly} onChange={value => updateSite("bariumProcedure", value)} />
            <InlineField label="Погодинне дослідження" multiline rows={6} value={siteContent.bariumTransit} readOnly={readOnly} onChange={value => updateSite("bariumTransit", value)} />
          </section>
          <div className="sfHowResult"><InlineField label="Назва блоку про опис" className="sfHowStepTitle" value={siteContent.howResultTitle} readOnly={readOnly} onChange={value => updateSite("howResultTitle", value)} /><InlineField label="Порядок надання опису знімків" multiline rows={5} value={siteContent.howResult} readOnly={readOnly} onChange={value => updateSite("howResult", value)} /></div>
        </section>

        <article className="sfAudienceCard civilian">
          <span className="sfAudienceIcon" aria-hidden="true">+</span>
          <div>
            <InlineField label="Заголовок для цивільних" className="sfAudienceTitle" value={siteContent.civTitle} readOnly={readOnly} onChange={value => updateSite("civTitle", value)} />
            <InlineField label="Підпис для цивільних" className="sfAudienceSub" value={siteContent.civSub} readOnly={readOnly} onChange={value => updateSite("civSub", value)} />
          </div>
          <span className="sfAudienceArrow" aria-hidden="true">›</span>
        </article>

        <section className="sfHowCard civilianHow" aria-label="Порядок для цивільних пацієнтів">
        <span className="sfKicker">Як це працює для цивільних</span>
        <InlineField label="Заголовок порядку для цивільних" className="sfHowTitle" value={siteContent.civHowTitle} readOnly={readOnly} onChange={value => updateSite("civHowTitle", value)} />
        <div className="sfHowSteps civilian">
          <article><span>1</span><div><b>Запис на сайті</b><InlineField label="Запис цивільного пацієнта" multiline rows={3} value={siteContent.civHowBooking} readOnly={readOnly} onChange={value => updateSite("civHowBooking", value)} /></div></article>
          <article><span>2</span><div><b>Прибуття</b><InlineField label="Прибуття цивільного пацієнта" multiline rows={3} value={siteContent.civHowArrival} readOnly={readOnly} onChange={value => updateSite("civHowArrival", value)} /></div></article>
          <article><span>3</span><div><b>Оплата</b><InlineField label="Оплата цивільного пацієнта" multiline rows={3} value={siteContent.civHowPayment} readOnly={readOnly} onChange={value => updateSite("civHowPayment", value)} /></div></article>
          <article><span>4</span><div><b>Дослідження і результат</b><InlineField label="Дослідження та результат цивільного пацієнта" multiline rows={3} value={siteContent.civHowResult} readOnly={readOnly} onChange={value => updateSite("civHowResult", value)} /></div></article>
        </div>
        <div className="sfAccessNotice"><b>Важливо перед візитом</b><InlineField label="Правила входу на територію" multiline rows={3} value={siteContent.accessNotice} readOnly={readOnly} onChange={value => updateSite("accessNotice", value)} /></div>
        </section>
      </section>

      <section className="sfAboutCard" aria-label="Про відділення та показники">
        <span className="sfKicker">Про відділення</span>
        <h2>Досвід, підтверджений щоденною практикою</h2>
        <InlineField label="Інформація про відділення" className="sfAboutLead" multiline rows={3} value={siteContent.about} readOnly={readOnly} onChange={value => updateSite("about", value)} />
        <p className="sfVolume">Щороку наші фахівці виконують близько <b>{formatNumber(total)} досліджень</b> — понад <b>80 досліджень щодня</b>. Такий обсяг роботи підтверджує значний практичний досвід, відпрацьовані процеси та постійну готовність до проведення діагностики.</p>
        <div className="sfStats" aria-label="Показники 2025 року">
          <div className="sfStat total">
            <strong>{formatNumber(total)}</strong>
            <InlineField label="Підпис загального показника" className="sfStatLabel" value={structure.statistics2025.title} readOnly={readOnly} onChange={value => updateStats("title", value)} />
          </div>
          {structure.statistics2025.breakdown.map((item, index) => <div className="sfStat" key={item.id}>
            <input
              className="sfEditable sfStatValue"
              aria-label={`Кількість: ${item.label}`}
              type="number"
              min="0"
              value={item.value}
              readOnly={readOnly}
              onChange={event => updateMetric(index, "value", event.target.value)}
            />
            <InlineField label={`Назва показника ${index + 1}`} className="sfStatLabel" value={item.label} readOnly={readOnly} onChange={value => updateMetric(index, "label", value)} />
          </div>)}
        </div>
        <p className="sfAudienceNote">Військовослужбовцям дослідження проводяться <b>безоплатно за направленням</b>. Для цивільних пацієнтів доступна <b>платна діагностика за попереднім записом</b>.</p>
      </section>

      <section className="sfManagedSection" aria-label="Тарифи керуються окремо">
        <div>
          <span className="sfKicker">Тарифи</span>
          <h2>Дослідження та вартість</h2>
          <p>Цей блок автоматично показує чинні ціни. Щоб змінити послугу або вартість, відкрийте окремий редактор тарифів.</p>
        </div>
        <a className="sfManagedLink" href="/staff/tariffs">Редагувати тарифи <span aria-hidden="true">→</span></a>
      </section>

      <section className="sfContactsEditor" aria-label="Контакти публічного сайту">
        <div className="sfContactRow">
          <b>Телефон</b>
          <InlineField label="Телефон" className="sfContactValue" value={siteContent.phone} readOnly={readOnly} onChange={value => updateSite("phone", value)} />
          <span aria-hidden="true">›</span>
        </div>
        <div className="sfContactRow">
          <b>Адреса</b>
          <InlineField label="Адреса" className="sfContactValue" value={siteContent.address} readOnly={readOnly} onChange={value => updateSite("address", value)} />
          <span aria-hidden="true">›</span>
        </div>
        <div className="sfContactRow hours">
          <b>Режим роботи</b>
          <InlineField label="Режим роботи" className="sfContactValue" value={siteContent.workHours} readOnly={readOnly} onChange={value => updateSite("workHours", value)} />
        </div>
      </section>
    </div>

    <details className="sfInternalDetails">
      <summary><span>Службова структура відділення</span><small>Госпіталь, ліцензія, кабінети, обладнання, штат і деталізований графік</small></summary>
      <div className="sfInternalBody">
        <section className="sfInternalSection">
          <h3>Госпіталь і відділення</h3>
          <div className="sfFieldGrid">
            {(Object.keys(structure.hospital) as Array<keyof DepartmentStructure["hospital"]>).map(key => <label className="sfField" key={key}>
              <span>{({ name: "Назва госпіталю", unit: "Військова частина", address: "Адреса", edrpou: "ЄДРПОУ" } as const)[key]}</span>
              <input value={structure.hospital[key]} readOnly={readOnly} onChange={event => updateHospital(key, event.target.value)} />
            </label>)}
          </div>
          <label className="sfField"><span>Назва відділення</span><input value={structure.department.name} readOnly={readOnly} onChange={event => updateDepartment("name", event.target.value)} /></label>
          <label className="sfField"><span>Інформація про відділення</span><textarea rows={3} value={structure.department.about} readOnly={readOnly} onChange={event => updateDepartment("about", event.target.value)} /></label>
          <label className="sfField"><span>Невідкладна допомога</span><input value={structure.department.emergency} readOnly={readOnly} onChange={event => updateDepartment("emergency", event.target.value)} /></label>
        </section>

        <section className="sfInternalSection">
          <h3>Ліцензія</h3>
          <div className="sfFieldGrid">
            {(Object.keys(structure.license) as Array<keyof DepartmentStructure["license"]>).map(key => <label className="sfField" key={key}>
              <span>{({ number: "Номер", series: "Серія", authority: "Орган", activity: "Діяльність", issued: "Видана", validUntil: "Дійсна до", changes: "Зміни" } as const)[key]}</span>
              <input value={structure.license[key]} readOnly={readOnly} onChange={event => updateLicense(key, event.target.value)} />
            </label>)}
          </div>
        </section>

        <section className="sfInternalSection">
          <h3>Кабінети й обладнання</h3>
          <div className="sfRoomEditor">{structure.rooms.map((room, roomIndex) => <article key={room.id}>
            <label className="sfField"><span>Назва кабінету</span><input value={room.name} readOnly={readOnly} onChange={event => updateRoom(roomIndex, event.target.value)} /></label>
          </article>)}</div>
          <p className="settingsHint">Моделі, характеристики та стан апаратів ведуться лише в єдиному реєстрі обладнання.</p>
          <a className="button compact" href="/staff/equipment">Відкрити реєстр обладнання</a>
        </section>

        <section className="sfInternalSection">
          <h3>Штат і деталізований графік</h3>
          <div className="sfFieldGrid">{structure.personnel.map((item, index) => <div className="sfPersonnelRow" key={index}>
            <label className="sfField"><span>Посада</span><input value={item.position} readOnly={readOnly} onChange={event => updatePersonnel(index, "position", event.target.value)} /></label>
            <label className="sfField"><span>Примітка</span><input value={item.note} readOnly={readOnly} onChange={event => updatePersonnel(index, "note", event.target.value)} /></label>
          </div>)}</div>
          <p className="settingsHint">Години, робочі дні, обід, винятки та персонал налаштовуються окремо для кожного кабінету.</p>
          <a className="button compact" href="/staff/schedule">Відкрити графік кабінетів</a>
          <a className="button compact secondary" href="/staff/services">Відкрити послуги кабінетів</a>
          <div className="sfFieldGrid compact">
            <label className="sfField"><span>Складні дослідження, %</span><input type="number" min="0" max="100" value={structure.statistics2025.complexShare} readOnly={readOnly} onChange={event => updateStats("complexShare", event.target.value)} /></label>
            <label className="sfField"><span>Обстежено учасників АТО</span><input type="number" min="0" value={structure.statistics2025.militaryExamined} readOnly={readOnly} onChange={event => updateStats("militaryExamined", event.target.value)} /></label>
          </div>
        </section>
      </div>
    </details>
  </form>;

  const body = forbidden
    ? <section className="accessDenied"><b>Захищений розділ</b><p>Редактор публічної вітрини доступний лише персоналу.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fstructure">Увійти для роботи</a></section>
    : !loaded
      ? <p className="dashLoading">Завантаження…</p>
      : error && !staff
        ? <p className="notice error" role="alert">{error}</p>
        : <>
            <div className="storefrontEditorToolbar">
              <div>
                <b>{canEdit ? "Редагуйте текст прямо на макеті" : "Перегляд публічної вітрини"}</b>
                <span>{canEdit ? "Поля підсвічуються при наведенні. Після змін натисніть «Зберегти»." : "Редагування доступне адміністратору."}</span>
              </div>
              <a className="sfOpenSite" href="/" target="_blank" rel="noopener">Відкрити сайт ↗</a>
              {canEdit ? <>
                <button className="sfResetButton" type="button" onClick={resetChanges} disabled={saving}>Скасувати зміни</button>
                <button className="sfSaveButton" type="submit" form="storefront-editor-form" disabled={saving}>{saving ? "Зберігаємо…" : "Зберегти"}</button>
              </> : null}
            </div>
            {notice ? <p className="notice success sfNotice" role="status">{notice}</p> : null}
            {error ? <p className="notice error sfNotice" role="alert">{error}</p> : null}
            {editor}
          </>;

  return <StaffWorkspaceShell
    active="structure"
    title="Публічна вітрина"
    description="Редагуйте головну сторінку так, як її бачить пацієнт. Тарифи та інші окремі довідники відкриваються у своїх редакторах."
    staffName={staff?.displayName}
    staffRole={staff?.role}
  >{body}</StaffWorkspaceShell>;
}
