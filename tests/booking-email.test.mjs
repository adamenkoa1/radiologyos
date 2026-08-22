import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("a new public booking e-mails the registrar when a gateway + recipient are set", async () => {
  const lib = await read("lib/booking-email.ts");
  // Gated on both the e-mail gateway and a recipient; never throws.
  assert.match(lib, /"email_gateway_url", "email_gateway_auth", "email_gateway_from", "booking_notify_email"/);
  // Falls back to the org's active administrators when no recipient is set.
  assert.match(lib, /m\.role = 'admin' AND m\.active = 1 AND s\.active = 1/);
  assert.match(lib, /if \(!cfg\.email_gateway_url \|\| !to\) return false/);
  assert.match(lib, /messaging\.sendEmail\(to, subject, text\)/);
  assert.match(lib, /catch \(error\)/);

  const route = await read("app/api/site-booking/route.ts");
  assert.match(route, /import \{ sendBookingEmail \} from "\.\.\/\.\.\/\.\.\/lib\/booking-email"/);
  assert.match(route, /await sendBookingEmail\(db, PUBLIC_ORGANIZATION_ID, \{/);
  assert.match(route, /items: services\.map\(/);
});

test("the registrar notification e-mail is configurable in staff settings", async () => {
  const route = await read("app/api/staff/settings/route.ts");
  assert.match(route, /"booking_notify_email"/);
  assert.match(route, /bookingNotifyEmail: values\.booking_notify_email/);
  assert.match(route, /Адреса для нових заявок некоректна/);
  assert.match(route, /await set\("booking_notify_email", bookingNotifyEmail\)/);

  const page = await read("app/staff/settings/page.tsx");
  assert.match(page, /E-mail для нових заявок/);
  assert.match(page, /bookingNotifyEmail/);
});
