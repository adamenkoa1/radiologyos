// Дії з календаря/картки пацієнта (підтвердити/перенести/скасувати) йдуть через
// спільний BookingDrawer, а самі мутації виконують батьківські хендлери. Два з
// них мали try/finally БЕЗ catch, тож мережевий throw від `void handler(...)`
// ковтався — дія ставала мовчазним no-op:
//   - app/staff/patients/page.tsx → drawerPatch
//   - app/staff/appointments/page.tsx → patchBooking (ще й ігнорував !res.ok)
// Обидва тепер показують помилку.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("patients drawerPatch surfaces a network failure (drawer confirm/reschedule)", async () => {
  const page = await read("app/staff/patients/page.tsx");
  assert.match(page, /async function drawerPatch\([\s\S]*?\} catch \{[\s\S]*?setActionError\("Немає зв’язку — дію не виконано[\s\S]*?\} finally \{ setDrawerBusy\(null\); \}/);
});

test("appointments patchBooking surfaces both a failed response and a network throw", async () => {
  const page = await read("app/staff/appointments/page.tsx");
  // !res.ok більше не ігнорується
  assert.match(page, /if \(res\.ok\) \{ await refetchBookings\(\); return; \}/);
  assert.match(page, /setActionError\(d\.error \|\| "Не вдалося виконати дію"\)/);
  // мережевий throw піднімається, а не ковтається
  assert.match(page, /\} catch \{\s*setActionError\("Немає зв’язку — дію не виконано[\s\S]*?\} finally \{ setBusyId\(null\); \}/);
  // і є місце, де помилку видно
  assert.match(page, /actionError && <p className="notice error" role="alert">\{actionError\}<\/p>/);
});
