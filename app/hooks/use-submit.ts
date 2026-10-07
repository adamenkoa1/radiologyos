"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Guards a form mutation against the three failure modes that the /staff
 * resilience audit kept finding in hand-written submit handlers:
 *
 *  - **double-submit** — a slow request clicked twice fires a duplicate
 *    POST/PATCH (e.g. two identical counterparties, two payments);
 *  - **silent failure** — a network throw swallowed by `void handler()` leaves
 *    the user with no error and no success, the form just "does nothing";
 *  - **stuck busy** — `busy` never reset because the throw skipped the reset.
 *
 * `run(fn)` executes `fn` at most once at a time: re-entry while a call is in
 * flight is a no-op (synchronous ref guard), `busy` is always reset in
 * `finally`, and a throw is routed to the optional `onError` instead of
 * escaping unhandled. Page-specific success/validation messaging stays inside
 * `fn`; only the unexpected-throw path goes to `onError`.
 *
 * Usage:
 *   const { busy, run } = useSubmit(() => setNotice("⚠ Не вдалося зберегти…"));
 *   async function save(e: FormEvent) {
 *     e.preventDefault();
 *     await run(async () => {
 *       const res = await fetch(url, { method: "POST", body });
 *       if (!res.ok) { setNotice("⚠ " + ...); return; }
 *       setNotice("✓ Збережено"); await load().catch(() => {});
 *     });
 *   }
 *   <button disabled={busy}>{busy ? "Збереження…" : "Зберегти"}</button>
 */
export function useSubmit(onError?: (error: unknown) => void) {
  const [busy, setBusy] = useState(false);
  // Synchronous re-entry guard: a ref flips before the first await, so a second
  // click while the request is in flight is a no-op even before `busy` paints.
  const inFlight = useRef(false);

  const run = useCallback(async (fn: () => Promise<void> | void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      onError?.(error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [onError]);

  return { busy, run };
}
