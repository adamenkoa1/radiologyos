# RadiologyOS production release smoke checklist

This checklist is the manual production gate after a Cloudflare deployment. Use synthetic data only. Never enter a real patient name, phone number, diagnosis, protocol, image, or other medical data during a release smoke test.

## 1. Preconditions

- The PR CI is green, including the **Production release gate** step.
- CodeQL is green.
- The linked critical P0 issues for booking capacity, tenant isolation, canonical service/price resolution, payment lifecycle, canonical public URL, and this release gate are closed.
- The deploy workflow recorded a D1 Time Travel recovery bookmark before applying migrations. Save the bookmark from the Actions log with the release SHA.
- Confirm the deployment is from the expected `main` SHA.

Stop the release if any item above is false.

## 2. Migration verification

Before deploy, record the D1 recovery bookmark:

```bash
npx wrangler d1 time-travel info radiologyos --config wrangler.cloudflare.toml
```

Apply migrations only through the production deploy workflow. After deploy, verify the expected schema exists without inspecting patient rows:

```bash
npx wrangler d1 execute radiologyos --remote --config wrangler.cloudflare.toml --json \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bookings','patient_sessions','payment_transactions','booking_events') ORDER BY name;"
```

Expected: all four table names are returned. For a release containing a new migration, additionally verify the new table/column/index named in that migration.

## 3. Public and security smoke

1. Open `https://radiologyos.tech/`; confirm the public storefront loads over HTTPS.
2. Open `/site/`; confirm it permanently redirects to `/` and does not render a duplicate homepage.
3. Confirm the civilian booking page shows the current service name and price from the server-backed catalog.
4. Check a patient-cabinet response and authenticated API response in browser DevTools. Private/authenticated responses must not be publicly cacheable.
5. Confirm expected security headers remain present, including anti-sniffing/frame policy where applicable.
6. Confirm patient cabinet pages are not indexable by search engines.

Stop the release for a wrong canonical URL, missing HTTPS, public caching of authenticated data, or missing critical security headers.

## 4. Synthetic patient journey

Use an obviously synthetic identity, for example:

- Name: `TEST RELEASE <short-sha>`
- Phone: a designated non-real test number controlled by the team; do not use a random real Ukrainian number.
- Notes: `SYNTHETIC RELEASE SMOKE — DELETE AFTER TEST`
- No diagnosis, medical history, images, real protocol text, or real personal data.

Run the following journey:

1. From the civilian booking flow, select an active service and confirm the displayed amount matches the current server-derived amount.
2. Create one synthetic booking in an unused future slot.
3. Attempt to create a second active booking for the same capacity-limited slot. It must be rejected or the slot must no longer be offered.
4. In the staff workspace, confirm the synthetic booking appears with the same service, date, time, code, and amount.
5. Confirm the booking, then reschedule it to another valid free slot. Verify the old capacity is released and the new capacity is reserved.
6. Authenticate the synthetic patient through the normal patient OTP/session flow using the designated test contact.
7. Confirm the patient sees only their own synthetic booking. A different booking code/id must not expose another patient's data (IDOR check).
8. Start/reconcile the synthetic civilian payment using the configured non-charge/manual test path. The authoritative amount must remain the server booking amount even if a different amount is sent from the browser/client.
9. Repeat the same payment reconciliation/provider reference. It must be idempotent and must not create a second paid transaction.
10. In staff workflow, move the synthetic study through the allowed arrival/performance/reporting states. Illegal state jumps must remain rejected.
11. Create only a harmless synthetic protocol marker such as `SYNTHETIC RELEASE SMOKE`. Confirm protocol access is limited to authorized staff and the owning patient session where patient delivery is enabled.
12. Confirm dashboard/reporting reflects one completed synthetic study and the reconciled payment without cross-tenant data.

Any ownership leak, duplicate active slot, client-controlled price, duplicate payment, unauthorized protocol access, or illegal workflow transition is a release blocker.

## 5. Tenant isolation check

For multi-tenant test fixtures/accounts only, verify that a staff or patient session for organization A cannot read or mutate a booking, payment, protocol, or dashboard data belonging to organization B. Do not perform this test against another real organization or real patient record.

A cross-tenant read or write is an immediate rollback condition.

## 6. Cleanup

Immediately after a successful or failed smoke test:

1. Locate the synthetic booking by its unique `TEST RELEASE <short-sha>` marker or booking code.
2. Delete/cancel the synthetic booking through the supported staff workflow where possible.
3. Remove synthetic protocol/report content and synthetic payment transaction created specifically for the smoke test if the product provides a supported cleanup/admin path. If the ledger is intentionally immutable, keep the synthetic transaction but ensure it is clearly marked/test-only and excluded from operational reporting according to the established finance procedure.
4. Revoke/delete the synthetic patient session and any OTP/test-session artifacts where supported.
5. Verify no synthetic booking occupies capacity and no synthetic record is mistaken for a real patient.
6. Record completion of cleanup in the release notes or deployment log. Do not paste medical or patient data into GitHub.

Never use direct production SQL deletion on real patient data as a smoke-test cleanup shortcut.

## 7. Rollback criteria

Rollback immediately when any of the following is observed after deployment:

- booking creation fails for valid slots or permits capacity collisions;
- a patient/staff user can access another tenant's or patient's record;
- authenticated/private data is cached publicly;
- payment amount can be overridden by the client, payment reconciliation duplicates charges/ledger entries, or paid state is inconsistent;
- required migrations are missing or application queries fail because schema and code are out of sync;
- staff cannot safely confirm/reschedule/complete studies;
- protocol/report permissions regress;
- the canonical site, booking flow, or critical API returns persistent 5xx errors.

## 8. Rollback procedure

1. Stop paid traffic and operational use of the affected flow.
2. Redeploy the last known-good Worker/application SHA if the failure is code-only.
3. If a migration caused data/schema corruption or the old application cannot run against the migrated schema, use the D1 Time Travel bookmark recorded immediately before deployment. Follow Cloudflare's current recovery procedure and confirm the recovery target before executing it.
4. After rollback, rerun the public/security smoke and a synthetic booking ownership check.
5. Open a blocking GitHub issue describing the release SHA, failed invariant, rollback action, and whether D1 recovery was used. Do not include patient data.

## Release decision

Production is considered ready only when automated CI/CodeQL gates are green, deployment completes, this smoke checklist passes, synthetic data is cleaned up, and all critical P0 release issues are closed.
