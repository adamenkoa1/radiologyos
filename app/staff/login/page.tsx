"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { PasswordInput } from "../PasswordInput";

function safeReturnTo(): string {
  if (typeof window === "undefined") return "/staff/appointments";
  const raw = new URLSearchParams(window.location.search).get("returnTo") || "/staff/appointments";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/staff/appointments";
}

export default function StaffLoginPage() {
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState("");
  const [stage, setStage] = useState<"credentials" | "totp">("credentials");
  // Зберігаємо облікові дані між кроками, щоб дослати їх разом із кодом 2FA.
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");

  async function attempt(payload: { phone: string; password: string; totpCode?: string }) {
    setStatus("sending"); setError("");
    const response = await fetch("/api/staff/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; needsTotp?: boolean; error?: string };
    setStatus("idle");
    if (result.needsTotp) { setStage("totp"); setError(""); return; }
    if (!response.ok || !result.ok) {
      setError(result.error || "Не вдалося увійти");
      return;
    }
    window.location.assign(safeReturnTo());
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const p = String(data.get("phone") || "");
    const pw = String(data.get("password") || "");
    setPhone(p); setPassword(pw);
    await attempt({ phone: p, password: pw });
  }

  async function submitTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await attempt({ phone, password, totpCode });
  }

  if (stage === "totp") {
    return <main className="loginShell">
      <form className="loginCard" onSubmit={submitTotp}>
        <span className="loginMark">R</span>
        <h1>Підтвердження входу</h1>
        <p>Введіть 6-значний код із застосунку-автентифікатора</p>
        <label>
          <span className="labelRow">Код автентифікації</span>
          <input
            name="totpCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            placeholder="123456" autoFocus required pattern="[0-9]*"
            value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\s+/g, ""))}
          />
        </label>
        {error && <p className="loginError" role="alert">{error}</p>}
        <button type="submit" disabled={status === "sending"}>{status === "sending" ? "Перевірка…" : "Підтвердити"}</button>
        <button
          type="button" className="loginBack" style={{ background: "none", border: 0, cursor: "pointer" }}
          onClick={() => { setStage("credentials"); setTotpCode(""); setError(""); }}
        >← Назад</button>
      </form>
    </main>;
  }

  return <main className="loginShell">
    <form className="loginCard" onSubmit={submitCredentials}>
      <span className="loginMark">R</span>
      <h1>RadiologyOS</h1>
      <p>Кабінет персоналу відділення променевої діагностики</p>
      <label>
        <span>Номер телефону</span>
        <input name="phone" type="tel" required autoComplete="username" inputMode="tel" placeholder="0XX XXX XX XX" autoFocus />
        <span className="fieldHint">Просто ваш номер — без +38. Напр.: 0972808899</span>
      </label>
      <label>
        <span className="labelRow">PIN-код</span>
        <PasswordInput name="password" autoComplete="current-password" placeholder="6-значний PIN" inputMode="numeric" maxLength={6} />
      </label>
      {error && <p className="loginError" role="alert">{error}</p>}
      <button type="submit" disabled={status === "sending"}>{status === "sending" ? "Вхід…" : "Увійти"}</button>
      <p className="loginAlt">Доступ і відновлення PIN-коду надає адміністратор системи.</p>
      <Link className="loginBack" href="/">← На головну</Link>
    </form>
  </main>;
}
