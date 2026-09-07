"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { roleLabelUk } from "../../../lib/labels";

type Profile = {
  email:string;
  phone:string;
  displayName:string;
  lastName:string;
  firstName:string;
  patronymic:string;
  contactEmail:string;
  militaryRank:string;
  positionTitle:string;
  departmentName:string;
  dateOfBirth:string;
  personnelId:string | null;
  hasPersonnelRecord:boolean;
  role:string;
  active:number;
};

function TwoFactorSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/staff/2fa", { cache: "no-store" });
        const d = await r.json().catch(() => ({})) as { enabled?: boolean };
        if (!cancelled) setEnabled(Boolean(d.enabled));
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await fetch("/api/staff/2fa", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const d = await r.json().catch(() => ({})) as { ok?: boolean; secret?: string; otpauthUri?: string; error?: string };
      if (!r.ok || !d.ok) { setErr(d.error || "Не вдалося виконати дію"); return null; }
      return d;
    } catch {
      setErr("Мережа недоступна"); return null;
    } finally {
      setBusy(false);
    }
  }

  async function begin() {
    const d = await post("begin");
    if (d) { setSecret(d.secret || ""); setUri(d.otpauthUri || ""); setCode(""); }
  }
  async function confirm() {
    const d = await post("confirm", { code });
    if (d) { setEnabled(true); setSecret(""); setUri(""); setCode(""); setMsg("Двофакторну автентифікацію увімкнено."); }
  }
  async function disable() {
    const d = await post("disable", { code });
    if (d) { setEnabled(false); setCode(""); setMsg("Двофакторну автентифікацію вимкнено."); }
  }

  return <section className="orgProfileCard">
    <h3>Двофакторна автентифікація (2FA)</h3>
    <p className="orgProfileHint">
      Додатковий код із застосунку-автентифікатора (Google Authenticator, FreeOTP, Aegis) під час входу.
      Наполегливо рекомендовано для адміністраторів. Працює офлайн — не залежить від SMS чи e-mail.
    </p>
    {err && <p className="notice bad" role="alert">{err}</p>}
    {msg && <p className="notice good" role="status">{msg}</p>}
    {enabled === null ? <p className="dashLoading">Завантаження…</p>
      : enabled ? <div className="formGrid">
        <p className="notice good">2FA увімкнено для вашого акаунта.</p>
        <label>Код із застосунку, щоб вимкнути
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\s+/g, ""))} inputMode="numeric" maxLength={6} placeholder="123456" />
        </label>
        <div><button className="button" type="button" onClick={() => void disable()} disabled={busy || code.length !== 6}>{busy ? "…" : "Вимкнути 2FA"}</button></div>
      </div>
      : secret ? <div className="formGrid">
        <p className="orgProfileHint">1) Додайте акаунт у застосунок-автентифікатор — відскануйте QR або введіть ключ вручну:</p>
        <label>Ключ (base32)
          <input value={secret} readOnly onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em" }} />
        </label>
        <p className="orgProfileHint">Або посилання для авто-додавання: <code style={{ wordBreak: "break-all" }}>{uri}</code></p>
        <label>2) Введіть 6-значний код із застосунку для підтвердження
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\s+/g, ""))} inputMode="numeric" maxLength={6} placeholder="123456" autoFocus />
        </label>
        <div><button className="button" type="button" onClick={() => void confirm()} disabled={busy || code.length !== 6}>{busy ? "…" : "Підтвердити й увімкнути"}</button></div>
      </div>
      : <div><button className="button" type="button" onClick={() => void begin()} disabled={busy}>{busy ? "…" : "Увімкнути 2FA"}</button></div>}
  </section>;
}

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

  async function patchProfile(payload:Record<string, unknown>) {
    setSaving(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/staff/profile", {
        method:"PATCH",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify(payload),
      });
      const data = await response.json().catch(()=>({})) as { error?:string; signedOut?:boolean };
      if (!response.ok) throw new Error(data.error || "Не вдалося зберегти профіль");
      if (data.signedOut) {
        window.location.assign("/staff/login?returnTo=%2Fstaff%2Fprofile&changed=1");
        return false;
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти профіль");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function savePersonal(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload:Record<string, unknown> = {
      lastName:String(form.get("lastName") || ""),
      firstName:String(form.get("firstName") || ""),
      patronymic:String(form.get("patronymic") || ""),
      contactEmail:String(form.get("contactEmail") || ""),
    };
    if (profile?.hasPersonnelRecord) payload.dateOfBirth = String(form.get("dateOfBirth") || "");
    if (await patchProfile(payload)) setSuccess("Особисті дані оновлено");
  }

  async function changePhone(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await patchProfile({
      phone:String(form.get("phone") || ""),
      currentPin:String(form.get("currentPin") || ""),
    });
  }

  async function changePin(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPin = String(form.get("currentPin") || "");
    const newPin = String(form.get("newPin") || "");
    const confirmPin = String(form.get("confirmPin") || "");
    if (newPin !== confirmPin) { setError("Новий PIN і підтвердження не збігаються"); return; }
    await patchProfile({ currentPin, newPin });
  }

  return <StaffWorkspaceShell
    active="overview"
    title="Особистий кабінет персоналу"
    description="Ваші особисті дані, логін за номером телефону та безпека облікового запису."
    staffName={profile?.displayName}
    staffRole={roleLabelUk(profile?.role)}
  >
    {error && <p className="notice bad" role="alert">{error}</p>}
    {success && <p className="notice good" role="status">{success}</p>}
    {!profile ? <p className="dashLoading">Завантаження…</p> : <div className="orgProfile">
      <section className="orgProfileCard">
        <h3>Особисті дані</h3>
        <p className="orgProfileHint">Ці дані належать тільки вашому профілю. Посада, роль і підрозділ змінюються керівництвом.</p>
        <form onSubmit={savePersonal} className="formGrid">
          <label>Прізвище<input name="lastName" defaultValue={profile.lastName || ""} required/></label>
          <label>Ім’я<input name="firstName" defaultValue={profile.firstName || ""} required/></label>
          <label>По батькові<input name="patronymic" defaultValue={profile.patronymic || ""}/></label>
          <label>Дата народження<input name="dateOfBirth" type="date" defaultValue={profile.dateOfBirth || ""} disabled={!profile.hasPersonnelRecord}/></label>
          <label>Контактний e-mail<input name="contactEmail" type="email" defaultValue={profile.contactEmail || ""}/></label>
          {!profile.hasPersonnelRecord && <div className="notice warning">Дата народження зберігається у кадровій картці. Адміністратор має спочатку прив’язати вашу картку персоналу до облікового запису.</div>}
          <div><button className="button" type="submit" disabled={saving}>{saving ? "Зберігаємо…":"Зберегти особисті дані"}</button></div>
        </form>
      </section>

      <section className="orgProfileCard">
        <h3>Логін: номер телефону</h3>
        <p className="orgProfileHint">Для входу до RadiologyOS використовується ваш номер телефону. Зміна логіна потребує поточного PIN і завершить усі активні сеанси.</p>
        <form onSubmit={changePhone} className="formGrid">
          <label>Телефон / логін<input name="phone" inputMode="tel" autoComplete="username" defaultValue={profile.phone || ""} required/></label>
          <label>Поточний PIN<input name="currentPin" type="password" inputMode="numeric" autoComplete="current-password" required/></label>
          <div><button className="button" type="submit" disabled={saving}>{saving ? "Змінюємо…":"Змінити логін"}</button></div>
        </form>
      </section>

      <section className="orgProfileCard">
        <h3>Пароль / PIN-код</h3>
        <p className="orgProfileHint">Після зміни PIN усі активні сеанси буде завершено. Увійдіть знову вже з новим кодом.</p>
        <form onSubmit={changePin} className="formGrid">
          <label>Поточний PIN<input name="currentPin" type="password" inputMode="numeric" autoComplete="current-password" required/></label>
          <label>Новий PIN<input name="newPin" type="password" inputMode="numeric" autoComplete="new-password" minLength={6} required/></label>
          <label>Повторіть новий PIN<input name="confirmPin" type="password" inputMode="numeric" autoComplete="new-password" minLength={6} required/></label>
          <div><button className="button" type="submit" disabled={saving}>{saving ? "Змінюємо…":"Змінити PIN"}</button></div>
        </form>
      </section>

      <TwoFactorSection />

      <section className="orgProfileCard">
        <h3>Службові дані</h3>
        <div className="formGrid">
          <label>Посада<input value={profile.positionTitle || ""} readOnly/></label>
          <label>Військове звання<input value={profile.militaryRank || ""} readOnly/></label>
          <label>Підрозділ<input value={profile.departmentName || ""} readOnly/></label>
          <label>Роль у системі<input value={roleLabelUk(profile.role)} readOnly/></label>
        </div>
        <p className="orgProfileHint">Службові повноваження не можна змінити з особистого кабінету.</p>
      </section>
    </div>}
  </StaffWorkspaceShell>;
}
