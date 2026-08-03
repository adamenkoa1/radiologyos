"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { PasswordInput } from "../PasswordInput";

export default function StaffActivationPage() {
  const tokenRef = useRef("");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    tokenRef.current = params.get("token") || "";
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!tokenRef.current) {
      setError("Відкрийте повне посилання активації");
      return;
    }
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    const confirmation = String(data.get("confirmation") || "");
    if (password !== confirmation) {
      setError("PIN-коди не збігаються");
      return;
    }
    setStatus("sending");
    const response = await fetch("/api/staff/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: tokenRef.current,
        phone: String(data.get("phone") || ""),
        password,
      }),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setStatus("idle");
      setError(result.error || "Не вдалося активувати доступ");
      return;
    }
    setStatus("done");
    window.location.assign("/staff");
  }

  return <main className="loginShell">
    <form className="loginCard" onSubmit={submit}>
      <span className="loginMark">R</span>
      <h1>Активація доступу</h1>
      <p>Вкажіть робочий номер телефону та створіть новий шестизначний PIN для адміністратора.</p>
      <label>
        <span>Номер телефону</span>
        <input name="phone" type="tel" required autoComplete="username" inputMode="tel" placeholder="0XX XXX XX XX" autoFocus />
        <span className="fieldHint">Вводьте без +38</span>
      </label>
      <label>
        <span className="labelRow">Новий PIN-код</span>
        <PasswordInput name="password" autoComplete="new-password" placeholder="6 цифр" inputMode="numeric" maxLength={6} />
      </label>
      <label>
        <span className="labelRow">Повторіть PIN-код</span>
        <PasswordInput name="confirmation" autoComplete="new-password" placeholder="6 цифр" inputMode="numeric" maxLength={6} />
      </label>
      {error && <p className="loginError" role="alert">{error}</p>}
      <button type="submit" disabled={status !== "idle"}>
        {status === "sending" ? "Активація…" : status === "done" ? "Готово" : "Активувати доступ"}
      </button>
      <p className="loginAlt">Посилання одноразове. Після активації використовуйте звичайну сторінку входу.</p>
      <Link className="loginBack" href="/staff/login">← До входу</Link>
    </form>
  </main>;
}
