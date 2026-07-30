"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { PasswordInput } from "../PasswordInput";

function safeReturnTo(): string {
  if (typeof window === "undefined") return "/staff";
  const raw = new URLSearchParams(window.location.search).get("returnTo") || "/staff";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/staff";
}

export default function StaffLoginPage() {
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending"); setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/staff/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: String(data.get("email") || ""), password: String(data.get("password") || "") }),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setStatus("idle");
      setError(result.error || "Не вдалося увійти");
      return;
    }
    window.location.assign(safeReturnTo());
  }

  return <main className="loginShell">
    <form className="loginCard" onSubmit={submit}>
      <span className="loginMark">R</span>
      <h1>RadiologyOS</h1>
      <p>Кабінет персоналу відділення променевої діагностики</p>
      <label><span>Робочий email</span><input name="email" type="email" required autoComplete="username" placeholder="name@example.com" autoFocus /></label>
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
