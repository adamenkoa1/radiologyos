import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("patient-otp delivers over email using the org email gateway with an on-file address", async () => {
  const route = await read("app/api/patient-otp/route.ts");
  // Reads the same org-scoped email gateway the registrar notification uses.
  assert.match(route, /getOrganizationIntegrationSettings\(db, PRIMARY_ORGANIZATION_ID, \[/);
  assert.match(route, /"email_gateway_url", "email_gateway_auth", "email_gateway_from"/);
  // Either channel is enough; neither → fail closed before identity lookup.
  assert.match(route, /if \(!messaging\.capabilities\.sms && !messaging\.capabilities\.email\)/);
  // The address is looked up on the server from the record, never taken from input.
  assert.match(route, /async function emailOnFileForIdentity/);
  assert.match(route, /patient_email AS email FROM bookings/);
  assert.match(route, /FROM patient_profiles WHERE organization_id = \? AND patient_id = \?/);
  // Email preferred when on file, else SMS, else opaque (no deliverable channel).
  assert.match(route, /const channel: "email" \| "sms" \| "" = emailTarget/);
  assert.match(route, /if \(!channel\) \{[\s\S]*opaqueChallengeResponse\(\)/);
  assert.match(route, /await messaging\.sendEmail\(emailTarget, emailSubject, emailText\)/);
  // Masked hint only — the identity is already proven before it is shown.
  assert.match(route, /function maskedEmail/);
  assert.match(route, /channel === "email"[\s\S]*надіслано на вашу пошту/);
});

test("the patient cabinet offers an email one-time-code login path", async () => {
  const cabinet = await read("public/site/cabinet.html");
  assert.match(cabinet, /id="emailOtpBtn"/);
  assert.match(cabinet, /async function requestEmailOtp\(\)/);
  // Uses the OTP request endpoint and then reveals the existing code-entry step.
  assert.match(cabinet, /fetch\(OTP_API,\{method:'POST'[\s\S]*bookingCode:code/);
  assert.match(cabinet, /challengeId=data\.challengeId/);
  assert.match(cabinet, /getElementById\('emailOtpBtn'\)\.addEventListener\('click',requestEmailOtp\)/);
});
