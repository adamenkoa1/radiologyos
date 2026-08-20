"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { roleLabelUk } from "../../../lib/labels";

type Profile = {
  email:string; phone:string; displayName:string; lastName:string; firstName:string; patronymic:string;
  contactEmail:string; militaryRank:string; positionTitle:string; role:string; active:number;
};

export default function StaffProfilePage() {
  const [profile,setProfile] = useState<Profile|null>(null);
  const [error,setError] = useState("");
  const [success,setSuccess] = useState("");
  const [saving,setSaving] = useState(false);

  async function load() {
    const response = await fetch("/api/staff/profile", { cache:"no-store" });
    const data = await response.json().catch(()=>({})) as { profile?:Profile; error?:string };
    if (!response.ok) { setError(data.error || "Не вдалося завантажити профіль"); return; }
    setProfile(data.profile || null);
    setError("");
  }

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/staff/profile", { cache:"no-store" })
      .then(async (response) => ({
        response,
        data: await response.json().catch(()=>({})) as { profile?:Profile; error?:string },
      }))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (!response.ok) {
          setError(data.error || "Не вдалося завантажити профіль");
          return;
        }
        setProfile(data.profile || null);
        setError("");
      })
      .catch(() => {
        if (!cancelled) setError("Не вдалося завантажити профіль");
      });
    return () => { cancelled = true; };
  },[]);

  async function saveProfile(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setError(""); setSuccess("");
    const response = await fetch("/api/staff/profile", {
      method:"PATCH",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({
        phone:String(form.get("phone") || ""),
        currentPin:String(form.get("currentPin") || ""),
        lastName:String(form.get("lastName") || ""),
        firstName:String(form.get("firstName") || ""),
        patronymic:String(form.get("patronymic") || ""),
        contactEmail:String(form.get("contactEmail") || ""),
        militaryRank:String(form.get("militaryRank") || ""),
        positionTitle:String(form.get("positionTitle") || ""),
      }),
    });
    const data = await response.json().catch(()=>({})) as { error?:string; signedOut?:boolean };
    setSaving(false);
    if (!response.ok) { setError(data.error || "Не вдалося зберегти профіль"); return; }
    if (data.signedOut) {
      window.location.assign("/staff/login?returnTo=%2Fstaff%2Fprofile&changed=1");
      return;
    }
    setSuccess("Профіль оновлено");
    await load();
  }

  async function changePin(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPin = String(form.get("currentPin") || "");
    const newPin = String(form.get("newPin") || "");
    const confirmPin = String(form.get("confirmPin") || "");
    if (newPin !== confirmPin) { setError("Новий PIN і підтвердження не збігаються"); return; }
    setSaving(true); setError(""); setSuccess("");
    const response = await fetch("/api/staff/profile", {
      method:"PATCH",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({ currentPin, newPin }),
    });
    const data = await response.json().catch(()=>({})) as { error?:string; signedOut?:boolean };
    setSaving(false);
    if (!response.ok) { setError(data.error || "Не вдалося змінити PIN"); return; }
    if (data.signedOut) {
      window.location.assign("/staff/login?returnTo=%2Fstaff%2Fprofile&changed=1");
      return;
    }
    setSuccess("PIN-код змінено");
    event.currentTarget.reset();
  }

  return <StaffWorkspaceShell
    active="organization"
    title="Мій профіль"
    description="Контактні дані, посада та безпека робочого облікового запису."
    staffName={profile?.displayName}
    staffRole={roleLabelUk(profile?.role)}
  >
    {error && <p className="notice bad">{error}</p>}
    {success && <p className="notice good">{success}</p>}
    {!profile ? <p className="dashLoading">Завантаження…</p> : <div className="orgProfile">
      <section className="orgProfileCard">
        <h3>Профіль працівника</h3>
        <form onSubmit={saveProfile} className="formGrid">
          <label>Прізвище<input name="lastName" defaultValue={profile.lastName || ""}/></label>
          <label>Ім’я<input name="firstName" defaultValue={profile.firstName || ""}/></label>
          <label>По батькові<input name="patronymic" defaultValue={profile.patronymic || ""}/></label>
          <label>Телефон<input name="phone" inputMode="tel" defaultValue={profile.phone || ""}/></label>
          <label>Поточний PIN для зміни телефону<input name="currentPin" type="password" inputMode="numeric" autoComplete="current-password" placeholder="Потрібен лише якщо змінюєте телефон"/></label>
          <label>Контактний e-mail<input name="contactEmail" type="email" defaultValue={profile.contactEmail || ""}/></label>
          <label>Військове звання<input name="militaryRank" defaultValue={profile.militaryRank || ""}/></label>
          <label>Посада<input name="positionTitle" defaultValue={profile.positionTitle || ""}/></label>
          <div><small>Роль у системі: <b>{roleLabelUk(profile.role)}</b>. Зміна номера входу потребує поточного PIN і завершить усі активні сеанси.</small></div>
          <div><button className="button" type="submit" disabled={saving}>{saving ? "Зберігаємо…":"Зберегти профіль"}</button></div>
        </form>
      </section>

      <section className="orgProfileCard">
        <h3>Змінити PIN-код</h3>
        <p className="orgProfileHint">Після зміни PIN усі активні сеанси буде завершено. Увійдіть знову вже з новим кодом.</p>
        <form onSubmit={changePin} className="formGrid">
          <label>Поточний PIN<input name="currentPin" type="password" inputMode="numeric" autoComplete="current-password" required/></label>
          <label>Новий PIN<input name="newPin" type="password" inputMode="numeric" autoComplete="new-password" minLength={6} required/></label>
          <label>Повторіть новий PIN<input name="confirmPin" type="password" inputMode="numeric" autoComplete="new-password" minLength={6} required/></label>
          <div><button className="button" type="submit" disabled={saving}>{saving ? "Змінюємо…":"Змінити PIN"}</button></div>
        </form>
      </section>
    </div>}
  </StaffWorkspaceShell>;
}