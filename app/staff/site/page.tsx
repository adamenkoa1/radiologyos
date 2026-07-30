"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { SITE_CONTENT_DEFAULTS, type SiteContent } from "../../../lib/site-content";

type StaffInfo = { email: string; displayName: string; role: string };
type Field = { key: keyof SiteContent; label: string; area?: boolean; hint?: string };

const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "Бренд і шапка", fields: [
    { key: "brandTitle", label: "Назва закладу" },
    { key: "brandSubtitle", label: "Підзаголовок" },
    { key: "slogan", label: "Слоган", hint: "Необовʼязково — показується під підзаголовком" },
  ] },
  { title: "Картки авдиторій (головна)", fields: [
    { key: "milTitle", label: "Військовим — заголовок" },
    { key: "milSub", label: "Військовим — підпис" },
    { key: "civTitle", label: "Цивільним — заголовок" },
    { key: "civSub", label: "Цивільним — підпис" },
  ] },
  { title: "Контакти", fields: [
    { key: "phone", label: "Телефон" },
    { key: "address", label: "Адреса" },
    { key: "workHours", label: "Години роботи" },
  ] },
  { title: "Про клініку", fields: [
    { key: "about", label: "Опис", area: true, hint: "Необовʼязково — короткий блок на головній" },
  ] },
  { title: "Сторінка цивільних (прайс)", fields: [
    { key: "pricePageTitle", label: "Заголовок сторінки" },
    { key: "pricePageSub", label: "Підзаголовок" },
    { key: "priceIntro", label: "Вступний текст", area: true },
    { key: "priceListTitle", label: "Заголовок прайсу" },
    { key: "priceLead", label: "Підпис під прайсом" },
  ] },
  { title: "Сторінка військових", fields: [
    { key: "milPageTitle", label: "Заголовок сторінки" },
    { key: "milPageSub", label: "Підзаголовок" },
    { key: "milNotice", label: "Примітка", area: true },
    { key: "milLead", label: "Підпис" },
  ] },
];

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
      setNotice("Збережено. Оновіть публічний сайт, щоб побачити зміни.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setStatus("idle");
    }
  }

  const body = forbidden
    ? <p className="notice error" role="alert">Сайт клініки редагує лише адміністратор.</p>
    : !loaded
      ? <p className="notice">Завантаження…</p>
      : <form className="settingsCard" onSubmit={save}>
          <section className="settingsBlock">
            <div className="siteToggleRow">
              <div>
                <b>{content.published ? "Сайт опубліковано" : "Сайт у чернетці"}</b>
                <p className="settingsHint">Коли вимкнено — відвідувачі бачать заглушку замість вітрини.</p>
              </div>
              <label className="switch">
                <input type="checkbox" checked={content.published} onChange={e => update("published", e.target.checked)} />
                <span>{content.published ? "Опубліковано" : "Чернетка"}</span>
              </label>
            </div>
          </section>
          {GROUPS.map(group => (
            <section className="settingsBlock" key={group.title}>
              <h3>{group.title}</h3>
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
            <a className="textLink" href="/" target="_blank" rel="noopener">Відкрити сайт ↗</a>
          </div>
        </form>;

  return (
    <StaffWorkspaceShell
      active="site"
      title="Сайт клініки"
      description="Публічна вітрина: тексти, контакти та публікація — керує адміністратор."
      staffName={staff?.displayName}
      staffRole={staff?.role}
    >
      {body}
    </StaffWorkspaceShell>
  );
}
