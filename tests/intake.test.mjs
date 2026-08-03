import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("bookings PATCH supports full booking correction (edit branch)", async () => {
  const route = await read("app/api/staff/bookings/route.ts");
  assert.match(route, /body\.edit && typeof body\.edit === "object"/);
  assert.match(route, /canManageBookings\(member\.role\)/); // лише реєстратор/адмін
  // Дозволені поля корекції.
  for (const col of ["name = \\?", "phone_normalized = \\?", "patient_email = \\?", "date_of_birth = \\?", "patient_category = \\?", "service_code = \\?"]) {
    assert.match(route, new RegExp(col));
  }
  assert.match(route, /'edited'/); // подія в журналі booking_events
  // Зміна послуги переобчислює апарат і тривалість.
  assert.match(route, /serviceByCode\(e\.serviceCode/);
  assert.match(route, /duration_minutes = \?/);
  // GET віддає дату народження для форми корекції.
  assert.match(route, /date_of_birth AS dateOfBirth/);
});

test("intake board page is a two-pane queue + editable detail, wired into the shell", async () => {
  const page = await read("app/staff/intake/page.tsx");
  assert.match(page, /active="intake"/);
  assert.match(page, /\/api\/staff\/bookings/);
  assert.match(page, /intakeQueue/);   // черга ліворуч
  assert.match(page, /intakeDetail/);  // картка праворуч
  assert.match(page, /edit:\{/);       // збереження корекції
  assert.match(page, /confirm:true/);  // підтвердження
  assert.match(page, /desiredDate:form\.date/); // перенесення
  assert.match(page, /status:"cancelled"/);     // скасування
  assert.match(page, /created_by_staff|Нова заявка/); // ручне створення
  assert.match(page, /🌐|✍️/);        // позначка джерела (сайт/вручну)
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/intake"/);
  assert.match(shell, /Дошка прийому/);
});
