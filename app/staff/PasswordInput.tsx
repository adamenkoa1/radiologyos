"use client";

import { useState } from "react";

interface PasswordInputProps {
  name: string;
  autoComplete: string;
  placeholder?: string;
  minLength?: number;
  autoFocus?: boolean;
}

// Password field with a show/hide (eye) toggle. Kept as its own client
// component so the login, registration and reset forms share one control.
export function PasswordInput({ name, autoComplete, placeholder, minLength, autoFocus }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="passwordField">
      <input
        name={name}
        type={visible ? "text" : "password"}
        required
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="passwordEye"
        onClick={() => setVisible((value) => !value)}
        aria-pressed={visible}
        aria-label={visible ? "Сховати пароль" : "Показати пароль"}
        title={visible ? "Сховати пароль" : "Показати пароль"}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7M9.9 5.1A9.6 9.6 0 0112 5c5 0 9 4.5 9 7 0 1-.7 2.2-1.9 3.4M6.1 6.2C3.9 7.6 3 9.6 3 12c0 2.5 4 7 9 7 1.4 0 2.7-.3 3.9-.9"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
        )}
      </button>
    </div>
  );
}
