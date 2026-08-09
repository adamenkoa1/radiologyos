"use client";

// Поле ПІБ із підказками українських імен і по батькові (реєстратор).
// Керований input: value/onChange назовні, випадайка — всередині.
// Логіка токенів спільна з публічним сайтом (lib/ukr-names.ts).

import { useRef, useState, type InputHTMLAttributes } from "react";
import { nameSuggestions, applyNameSuggestion } from "../../lib/ukr-names";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
};

export default function NameSuggestInput({ value, onChange, ...rest }: Props) {
  const [items, setItems] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  function refresh(v: string) {
    const next = nameSuggestions(v);
    setItems(next);
    setActive(-1);
  }

  function pick(s: string) {
    onChange(applyNameSuggestion(value, s));
    setItems([]);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === "Escape") { setItems([]); setActive(-1); }
  }

  return (
    <div className="nameSuggestField" ref={boxRef}>
      <input
        {...rest}
        autoComplete="off"
        value={value}
        onChange={(e) => { onChange(e.target.value); refresh(e.target.value); }}
        onFocus={(e) => refresh(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => window.setTimeout(() => setItems([]), 150)}
      />
      {items.length > 0 && (
        <ul className="nameSuggest nameSuggestInline">
          {items.map((s, i) => (
            <li
              key={s}
              className={i === active ? "on" : undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
