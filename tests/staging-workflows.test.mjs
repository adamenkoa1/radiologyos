// Автоматизація staging через GitHub Actions: валідність YAML і fail-safe
// інваріанти. Production workflow (deploy.yml) не змінюється й не запускається
// автоматично цими змінами. Жодних реальних id/доменів у staging-файлах.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import yaml from "js-yaml";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function prodD1Id() {
  const cfg = await read("wrangler.cloudflare.toml");
  return /database_id\s*=\s*"([^"]+)"/.exec(cfg)[1];
}

test("all workflows are valid YAML and define their jobs", async () => {
  for (const f of [
    ".github/workflows/ci.yml",
    ".github/workflows/deploy.yml",
    ".github/workflows/staging.yml",
    ".github/workflows/staging-restore-rehearsal.yml",
  ]) {
    const doc = yaml.load(await read(f));
    assert.ok(doc && typeof doc === "object", `${f} parses to an object`);
    assert.ok(doc.jobs && Object.keys(doc.jobs).length > 0, `${f} declares jobs`);
  }
});

test("ci.yml applies all D1 migrations to a local synthetic DB on PRs and uploads a report", async () => {
  const ci = await read(".github/workflows/ci.yml");
  assert.match(ci, /on:\s[\s\S]*pull_request:/);
  assert.match(ci, /node scripts\/apply-d1-migrations-local\.mjs/);
  assert.match(ci, /actions\/upload-artifact/);
  assert.match(ci, /Record release SHA/);
  // Наявні інваріанти збережено.
  assert.match(ci, /run: npm run test:production-gate/);
  assert.doesNotMatch(ci, /run: npm ci(?:\s|$)/);
});

test("staging workflow runs post-merge + manual, is gated, and never uses the production config", async () => {
  const s = await read(".github/workflows/staging.yml");
  const doc = yaml.load(s);
  // Тригери: push у main і ручний; НЕ на pull_request і НЕ деплой у прод.
  assert.match(s, /on:\s[\s\S]*push:\s[\s\S]*branches:\s*\[main\]/);
  assert.match(s, /workflow_dispatch:/);
  assert.doesNotMatch(s, /pull_request:/);
  // Гейт увімкнення.
  const job = doc.jobs.staging;
  assert.match(String(job.if), /vars\.STAGING_ENABLED == 'true'/);
  assert.equal(job.environment, "staging");
  // STAGING_ENABLED має бути repository-variable (job-level if не бачить
  // environment-variables) — зафіксовано коментарем, щоб не регресувало.
  assert.match(s, /REPOSITORY-variable/i);
  // Лише staging-конфіг у будь-якій операції Cloudflare; production-конфіг
  // може лише ЗЧИТУВАТИСЬ preflight-ом для порівняння, але ніколи не передається
  // як --config у wrangler.
  assert.match(s, /--config wrangler\.staging\.toml/);
  assert.doesNotMatch(s, /--config wrangler\.cloudflare\.toml/);
  assert.match(s, /apply-d1-migrations-remote\.sh radiologyos-staging wrangler\.staging\.toml drizzle/);
  // Построзгортальні перевірки: health + безпечний in-process E2E + summary/artifact.
  assert.match(s, /api\/public-services/);
  assert.match(s, /run: npm test/);
  assert.match(s, /GITHUB_STEP_SUMMARY/);
  assert.match(s, /actions\/upload-artifact/);
});

test("staging workflow runs the non-production preflight before any Cloudflare call", async () => {
  const s = await read(".github/workflows/staging.yml");
  assert.match(s, /node scripts\/staging-preflight\.mjs/);
  const preflight = s.indexOf("scripts/staging-preflight.mjs");
  const render = s.indexOf("wrangler.staging.example.toml > wrangler.staging.toml");
  const migrate = s.indexOf("apply-d1-migrations-remote.sh radiologyos-staging");
  const deploy = s.indexOf("wrangler deploy --keep-vars");
  assert.ok(preflight !== -1 && render !== -1, "preflight and render steps exist");
  assert.ok(preflight < render, "preflight must run before rendering the staging config");
  assert.ok(preflight < migrate && preflight < deploy, "preflight must run before any Cloudflare call");
});

test("staging workflow takes credentials from secrets and ids from vars, rendering config at runtime", async () => {
  const s = await read(".github/workflows/staging.yml");
  assert.match(s, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(s, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(s, /vars\.STAGING_D1_DATABASE_ID/);
  assert.match(s, /vars\.STAGING_HOSTNAME/);
  // Рендер з committed example + fail-closed на залишковий плейсхолдер.
  assert.match(s, /wrangler\.staging\.example\.toml > wrangler\.staging\.toml/);
  assert.match(s, /grep -Eq 'REPLACE_WITH_' wrangler\.staging\.toml/);
});

test("staging + rehearsal files never embed the production D1 id or hostname", async () => {
  const id = await prodD1Id();
  for (const f of [".github/workflows/staging.yml", ".github/workflows/staging-restore-rehearsal.yml", "wrangler.staging.example.toml"]) {
    const body = await read(f);
    assert.doesNotMatch(body, new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${f} must not embed the production D1 id`);
    assert.doesNotMatch(body, /radiologyos\.tech/, `${f} must not embed the production hostname`);
  }
});

test("restore rehearsal is manual-only, gated, and never targets production", async () => {
  const r = await read(".github/workflows/staging-restore-rehearsal.yml");
  const doc = yaml.load(r);
  // Лише ручний запуск.
  assert.match(r, /workflow_dispatch:/);
  assert.doesNotMatch(r, /\n\s*push:/);
  assert.doesNotMatch(r, /pull_request:/);
  const job = doc.jobs.rehearse;
  assert.match(String(job.if), /vars\.STAGING_ENABLED == 'true'/);
  assert.match(String(job.if), /confirmation == 'REHEARSE'/);
  assert.equal(job.environment, "staging");
  // Тимчасова база з власним патерном; продакшн id лише ЗЧИТУЄТЬСЯ для порівняння,
  // мутацій проти production-конфігу немає.
  assert.match(r, /sr-rehearsal-/);
  assert.doesNotMatch(r, /--config wrangler\.cloudflare\.toml/);
  assert.doesNotMatch(r, /wrangler deploy/);
  // Відмова від продакшн-ідентифікаторів.
  assert.match(r, /Refusing: temporary DB name must not be a real environment/);
  assert.match(r, /equals the PRODUCTION id/);
});

test("rehearsal cleanup deletes only its own throwaway DB and always runs", async () => {
  const r = await read(".github/workflows/staging-restore-rehearsal.yml");
  const doc = yaml.load(r);
  const steps = doc.jobs.rehearse.steps;
  const cleanup = steps.find((st) => /Cleanup/i.test(st.name || ""));
  assert.ok(cleanup, "a cleanup step exists");
  assert.equal(cleanup.if, "always()", "cleanup must run with always()");
  assert.match(cleanup.run, /wrangler d1 delete/);
  assert.match(cleanup.run, /\.restore-temp-db/);
  assert.match(cleanup.run, /Refusing to delete/);
  // Жорстка межа: не видаляти реальні середовища.
  assert.match(cleanup.run, /radiologyos\|radiologyos-staging/);
});

test("production deploy workflow remains production-only and untouched in contract", async () => {
  const d = await read(".github/workflows/deploy.yml");
  // Усе ще цілить лише у production-конфіг і не запускається нашими staging-змінами.
  assert.match(d, /--config wrangler\.cloudflare\.toml/);
  assert.doesNotMatch(d, /wrangler\.staging\.toml/);
  assert.doesNotMatch(d, /STAGING_ENABLED/);
});
