"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { PasswordInput } from "../PasswordInput";

export default function StaffRegisterPage() {
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    const confirm = String(data.get("confirm") || "");
    if (password !== confirm) {
      setError("Паролі не збігаються");
      return;
    }
    setStatus("sending");
    const response = await fetch("/api/staff/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: String(data.get("displayName") || ""),
        email: String(data.get("email") || ""),
        password,
        accessCode: String(data.get("accessCode") || ""),
      }),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setStatus("idle");
      setError(result.error || "Не вдалося створити акаунт");
      return;
    }
    window.location.assign("/staff");
  }

  return <main className="loginShell">
    <form className="loginCard" onSubmit={submit}>
      <span className="loginMark">R</span>
      <h1>Реєстрація персоналу</h1>
      <p>Створіть робочий акаунт для кабінету відділення. Потрібен код доступу відділення — його видає адміністратор.</p>
      <label><span>Ім’я та прізвище</span><input name="displayName" type="text" required minLength={2} autoComplete="name" placeholder="Іван Іваненко" autoFocus /></label>
      <label><span>Робочий email</span><input name="email" type="email" required autoComplete="username" placeholder="name@example.com" /></label>
      <label><span>Пароль</span><PasswordInput name="password" autoComplete="new-password" placeholder="Мінімум 8 символів, літери й цифри" minLength={8} /></label>
      <label><span>Повторіть пароль</span><PasswordInput name="confirm" autoComplete="new-password" placeholder="Ще раз той самий пароль" minLength={8} /></label>
      <label><span>Код доступу відділення</span><input name="accessCode" type="text" required autoComplete="off" placeholder="Код від адміністратора" /></label>
      {error && <p className="loginError" role="alert">{error}</p>}
      <button type="submit" disabled={status === "sending"}>{status === "sending" ? "Створюємо…" : "Створити акаунт"}</button>
      <p className="loginAlt">Уже є акаунт? <Link href="/staff/login">Увійти</Link></p>
      <Link className="loginBack" href="/">← На головну</Link>
    </form>
  </main>;
}
