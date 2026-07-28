"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { PasswordInput } from "../PasswordInput";

export default function StaffForgotPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
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
    const response = await fetch("/api/staff/reset", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: String(data.get("email") || ""),
        password,
        accessCode: String(data.get("accessCode") || ""),
      }),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setStatus("idle");
      setError(result.error || "Не вдалося змінити пароль");
      return;
    }
    setStatus("done");
  }

  if (status === "done") {
    return <main className="loginShell">
      <div className="loginCard">
        <span className="loginMark">✓</span>
        <h1>Пароль змінено</h1>
        <p>Новий пароль збережено. Тепер увійдіть із ним у кабінет персоналу.</p>
        <Link className="loginPrimaryLink" href="/staff/login">Перейти до входу</Link>
        <Link className="loginBack" href="/">← На головну</Link>
      </div>
    </main>;
  }

  return <main className="loginShell">
    <form className="loginCard" onSubmit={submit}>
      <span className="loginMark">R</span>
      <h1>Відновлення пароля</h1>
      <p>Вкажіть робочий email і код доступу відділення — і задайте новий пароль. Код видає адміністратор.</p>
      <label><span>Робочий email</span><input name="email" type="email" required autoComplete="username" placeholder="name@example.com" autoFocus /></label>
      <label><span>Код доступу відділення</span><input name="accessCode" type="text" required autoComplete="off" placeholder="Код від адміністратора" /></label>
      <label><span>Новий пароль</span><PasswordInput name="password" autoComplete="new-password" placeholder="Мінімум 8 символів, літери й цифри" minLength={8} /></label>
      <label><span>Повторіть пароль</span><PasswordInput name="confirm" autoComplete="new-password" placeholder="Ще раз той самий пароль" minLength={8} /></label>
      {error && <p className="loginError" role="alert">{error}</p>}
      <button type="submit" disabled={status === "sending"}>{status === "sending" ? "Зберігаємо…" : "Змінити пароль"}</button>
      <p className="loginAlt">Згадали пароль? <Link href="/staff/login">Увійти</Link></p>
      <Link className="loginBack" href="/">← На головну</Link>
    </form>
  </main>;
}
