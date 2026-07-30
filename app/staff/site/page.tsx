"use client";

import { type CSSProperties, FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { SITE_CONTENT_DEFAULTS, type SiteContent } from "../../../lib/site-content";

type StaffInfo = { email: string; displayName: string; role: string };
type Field = { key: keyof SiteContent; label: string; area?: boolean; hint?: string };
type Group = { n: string; title: string; where: string; fields: Field[] };

// Кожна група пронумерована так само, як зона на схемі вітрини нижче.
const GROUPS: Group[] = [
  { n: "1", title: "Шапка", where: "Верх сторінки", fields: [
    { key: "brandTitle", label: "Назва закладу" },
    { key: "brandSubtitle", label: "Підзаголовок" },
    { key: "slogan", label: "Слоган", hint: "Необовʼязково — під підзаголовком" },
  ] },
  { n: "3", title: "Картки авдиторій", where: "Великі кнопки на головній", fields: [
    { key: "milTitle", label: "Військовим — заголовок" },
    { key: "milSub", label: "Військовим — підпис" },
    { key: "civTitle", label: "Цивільним — заголовок" },
    { key: "civSub", label: "Цивільним — підпис" },
  ] },
  { n: "4", title: "Про клініку", where: "Блок під картками", fields: [
    { key: "about", label: "Опис", area: true, hint: "Необовʼязково — короткий блок на головній" },
  ] },
  { n: "5", title: "Контакти", where: "Блок унизу головної", fields: [
    { key: "phone", label: "Телефон" },
    { key: "address", label: "Адреса" },
    { key: "workHours", label: "Години роботи" },
  ] },
  { n: "6", title: "Сторінка цивільних (прайс)", where: "Окрема сторінка платних послуг", fields: [
    { key: "pricePageTitle", label: "Заголовок сторінки" },
    { key: "pricePageSub", label: "Підзаголовок" },
    { key: "priceIntro", label: "Вступний текст", area: true },
    { key: "priceListTitle", label: "Заголовок прайсу" },
    { key: "priceLead", label: "Підпис під прайсом" },
  ] },
  { n: "7", title: "Сторінка військових", where: "Окрема сторінка безкоштовних послуг", fields: [
    { key: "milPageTitle", label: "Заголовок сторінки" },
    { key: "milPageSub", label: "Підзаголовок" },
    { key: "milNotice", label: "Примітка", area: true },
    { key: "milLead", label: "Підпис" },
  ] },
];

const COLOR_PRESETS = ["#0c7a85", "#2f8f46", "#2563eb", "#6d28d9", "#b91c1c", "#b45309", "#0f172a"];

export default function StaffSitePage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [content, setContent] = useState<SiteContent>({ ...SITE_CONTENT_DEFAULTS });
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/staff/site", { cache: "no-store" });
      if (res.status === 403) { if (active) setForbidden(true); return; }
      const data = await res.json().catch(() => ({})) as { content?: SiteContent; staff?: StaffInfo };
      if (!active) return;
      if (data.content) setContent({ ...SITE_CONTENT_DEFAULTS, ...data.content });
      if (data.staff) setStaff(data.staff);
      setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

  function update(key: keyof SiteContent, value: string | boolean) {
    setContent(prev => ({ ...prev, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving"); setNotice(""); setError("");
    try {
      const res = await fetch("/api/staff/site", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; content?: SiteContent; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти");
      if (data.content) setContent({ ...SITE_CONTENT_DEFAULTS, ...data.content });
      setNotice("Збережено. Оновіть публічну вітрину, щоб побачити зміни.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setStatus("idle");
    }
  }

  const showMil = content.storefrontType !== "paid_only";

  const body = forbidden
    ? <p className="notice error" role="alert">Вітрину редагує лише адміністратор.</p>
    : !loaded
      ? <p className="notice">Завантаження…</p>
      : <form className="settingsCard" onSubmit={save}>
          {/* Схема: де на вітрині опиняється кожен блок (номери збігаються з групами) */}
          <section className="settingsBlock">
            <h3>Схема вітрини</h3>
            <p className="settingsHint">Номери підказують, у якій частині вітрини зʼявиться те, що ви редагуєте нижче.</p>
            <div className="siteSchema" style={{ "--brand": content.brandColor } as CSSProperties}>
              <div className="ssZone ssHeader"><span className="ssNum">1</span>Шапка — назва, підзаголовок, слоган{content.logoUrl ? ", логотип" : ""}</div>
              <div className="ssRow">
                {showMil && <div className="ssZone ssMil"><span className="ssNum">3</span>Картка «{content.milTitle || "Військовим"}»</div>}
                <div className="ssZone ssCiv"><span className="ssNum">3</span>Картка «{content.civTitle || "Цивільним"}»</div>
              </div>
              {content.about && <div className="ssZone"><span className="ssNum">4</span>Про клініку</div>}
              <div className="ssZone ssContact"><span className="ssNum">5</span>Контакти — телефон, адреса, години</div>
            </div>
            {!showMil && <p className="settingsHint">Вид «Тільки платні»: картку «Військовим» на вітрині приховано.</p>}
          </section>

          {/* Публікація */}
          <section className="settingsBlock">
            <div className="siteToggleRow">
              <div>
                <b>{content.published ? "Вітрину опубліковано" : "Вітрина у чернетці"}</b>
                <p className="settingsHint">Коли вимкнено — відвідувачі бачать заглушку замість вітрини.</p>
              </div>
              <label className="switch">
                <input type="checkbox" checked={content.published} onChange={e => update("published", e.target.checked)} />
                <span>{content.published ? "Опубліковано" : "Чернетка"}</span>
              </label>
            </div>
          </section>

          {/* Оформлення: вид, колір/тема, логотип */}
          <section className="settingsBlock">
            <h3>Оформлення</h3>
            <label className="settingsField">
              <span>Вид вітрини</span>
              <select value={content.storefrontType} onChange={e => update("storefrontType", e.target.value)}>
                <option value="paid_and_free">Платні + безкоштовні (військовим) — як зараз</option>
                <option value="paid_only">Тільки платні послуги</option>
              </select>
              <small className="settingsHint">«Тільки платні» ховає картку «Військовим» на головній.</small>
            </label>
            <label className="settingsField">
              <span>Фірмовий колір (тема)</span>
              <span className="colorRow">
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(content.brandColor) ? content.brandColor : "#0c7a85"} onChange={e => update("brandColor", e.target.value)} />
                <span className="colorSwatches">
                  {COLOR_PRESETS.map(c => (
                    <button type="button" key={c} className={`colorSwatch${content.brandColor.toLowerCase() === c ? " active" : ""}`} style={{ background: c }} title={c} aria-label={c} onClick={() => update("brandColor", c)} />
                  ))}
                </span>
              </span>
              <small className="settingsHint">Колір застосовується до шапки, кнопок і карток вітрини.</small>
            </label>
            <label className="settingsField">
              <span>Логотип (посилання на зображення)</span>
              <input type="url" value={content.logoUrl} onChange={e => update("logoUrl", e.target.value)} placeholder="https://…/logo.png" />
              <small className="settingsHint">Необовʼязково. Посилання на PNG/JPG/SVG (https). Зʼявиться у шапці.</small>
            </label>
          </section>

          {/* Тексти по зонах */}
          {GROUPS.map(group => (
            <section className="settingsBlock" key={group.title}>
              <h3><span className="ssNum">{group.n}</span>{group.title}</h3>
              <p className="settingsHint">{group.where}</p>
              {group.fields.map(field => (
                <label className="settingsField" key={String(field.key)}>
                  <span>{field.label}</span>
                  {field.area
                    ? <textarea rows={3} value={String(content[field.key] ?? "")} onChange={e => update(field.key, e.target.value)} />
                    : <input type="text" value={String(content[field.key] ?? "")} onChange={e => update(field.key, e.target.value)} />}
                  {field.hint && <small className="settingsHint">{field.hint}</small>}
                </label>
              ))}
            </section>
          ))}
          {notice && <p className="notice success" role="status">{notice}</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
          <div className="settingsActions">
            <button type="submit" disabled={status === "saving"}>{status === "saving" ? "Зберігаємо…" : "Зберегти зміни"}</button>
            <a className="textLink" href="/" target="_blank" rel="noopener">Відкрити вітрину ↗</a>
          </div>
        </form>;

  return (
    <StaffWorkspaceShell
      active="site"
      title="Вітрина"
      description="Публічна вітрина: вид, тексти, колір, логотип і публікація — керує адміністратор."
      staffName={staff?.displayName}
      staffRole={staff?.role}
    >
      {body}
    </StaffWorkspaceShell>
  );
}
