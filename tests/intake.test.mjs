import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { globalsCss } from "./helpers/css.mjs";

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
  // Зміна послуги бере tenant-effective визначення і переобчислює апарат/тривалість.
  assert.match(route, /effectiveServiceByCode\(db, e\.serviceCode/);
  assert.match(route, /ctx\.organizationId/);
  assert.match(route, /duration_minutes = \?/);
  // GET віддає дату народження для форми корекції.
  assert.match(route, /date_of_birth AS dateOfBirth/);
  // Зміна послуги оновлює суму з effective service; категорії — статус оплати;
  // фінанси не чіпаємо на оплачених; зміна апарата перевіряє слот.
  assert.match(route, /financeLocked/);
  assert.match(route, /"paid", "not_required"/);
  assert.match(route, /payment_amount = \?/);
  assert.match(route, /binds\.push\(svc\.price\)/);
  // Виправлено (аудит): повна перевірка слоту при зміні послуги (сітка/день/
  // блокування/накладання), а не лише конфлікт апарата.
  assert.match(route, /candidateTimesFor\(hoursFor\(rSchedule/);
  assert.match(route, /isEquipmentDayOpen\(cur\.d, rSchedule/);
  assert.match(route, /equipment_blocks/);
  // Закриті заявки не редагуються; email валідується; email зберігається при створенні.
  assert.match(route, /cur\.st === "cancelled"/);
  assert.match(route, /Некоректний email/);
  assert.match(route, /date_of_birth, patient_email,/); // POST зберігає email
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
  assert.match(page, /guardUnsaved/); // попередження про незбережені зміни (D4)
  // Виправлено (аудит): помилки завантаження не кладуться в data (не білий екран).
  assert.match(page, /!Array\.isArray\(payload\.bookings\) \|\| !payload\.staff/);
  // Notion-стиль: картка «живе» — контекст пацієнта та направлення.
  assert.match(page, /intakeCtx/);
  assert.match(page, /Попередні дослідження/);
  assert.match(page, /REFERRAL_UK/);
  assert.match(page, /intakeEdit/);
  // Телефон — контакт, а не identity: intake не має права самостійно зливати
  // записи в одну клінічну історію. Для цього користувач переходить у CRM,
  // де shared-phone вимагає вибрати конкретну картку patient_id.
  assert.doesNotMatch(page, /digits\(b\.phone\) === ph/);
  assert.doesNotMatch(page, /Перше звернення цього пацієнта \(за номером телефону\)/);
  assert.match(page, /Історію не визначаємо за номером телефону/);
  assert.match(page, /Картка пацієнта/);
  assert.match(page, /\/staff\/patients\?phone=/);
  assert.doesNotMatch(page, /<BookingDrawer/);
  const css = await globalsCss();
  assert.match(css, /\.intakeHistory\b/); // стилі identity-safe handoff секції
  assert.match(css, /\.intakeFacts\b/);   // сітка фактів
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/intake"/);
  assert.match(shell, /Дошка прийому/);
});
