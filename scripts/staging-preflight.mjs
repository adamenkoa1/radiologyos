// Staging preflight: доводить, що staging-змінні НЕ збігаються з production, ДО
// будь-якого звернення до Cloudflare. Fail-closed у всіх сумнівних випадках.
//
// Production-значення (D1 id, R2 bucket, hostname) читаються з канонічного
// wrangler.cloudflare.toml — нічого не захардкоджено, тож ротація безпечна.
// Staging-значення беруться з оточення (назви фіксовані нижче). Скрипт НЕ читає
// й НЕ друкує жодних креденшелів.
//
// Запуск:  node scripts/staging-preflight.mjs [--prod-config <path>]
// Env:     STAGING_D1_DATABASE_ID, STAGING_R2_BUCKET, STAGING_HOSTNAME

import { readFileSync } from "node:fs";
import { appendFileSync } from "node:fs";

function fail(message) {
  console.error(`✗ staging preflight: ${message}`);
  process.exit(1);
}

const prodConfigFlag = process.argv.indexOf("--prod-config");
const PROD_CONFIG = prodConfigFlag !== -1 ? process.argv[prodConfigFlag + 1] : "wrangler.cloudflare.toml";

// Fail-closed: без читабельного production-конфігу не можемо гарантувати
// розрізнення середовищ — відмовляємось.
let prodToml;
try {
  prodToml = readFileSync(PROD_CONFIG, "utf8");
} catch (e) {
  fail(`cannot read production config ${PROD_CONFIG} (${e.code || e.message}). Refusing (fail-closed).`);
}

function firstMatch(re, label) {
  const m = re.exec(prodToml);
  // Fail-closed: якщо production-значення не визначається — не продовжуємо.
  if (!m || !m[1] || !m[1].trim()) fail(`could not determine production ${label} from ${PROD_CONFIG}. Refusing (fail-closed).`);
  return m[1].trim();
}

const prod = {
  d1: firstMatch(/database_id\s*=\s*"([^"]+)"/, "D1 database_id"),
  bucket: firstMatch(/bucket_name\s*=\s*"([^"]+)"/, "R2 bucket_name"),
  host: firstMatch(/pattern\s*=\s*"([^"]+)"/, "route hostname"),
};

// Нормалізація hostname перед порівнянням: регістр, схема, шлях, порт, крапка.
function normHost(h) {
  return String(h || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

const staging = {
  d1: (process.env.STAGING_D1_DATABASE_ID || "").trim(),
  bucket: (process.env.STAGING_R2_BUCKET || "").trim(),
  host: (process.env.STAGING_HOSTNAME || "").trim(),
};

// Fail-closed: відсутні або плейсхолдерні staging-значення.
for (const [k, v] of Object.entries(staging)) {
  if (!v) fail(`missing staging value for ${k.toUpperCase()}. Refusing (fail-closed).`);
  if (/REPLACE_WITH_/i.test(v)) fail(`staging ${k.toUpperCase()} is still a placeholder (${v}). Refusing.`);
}

// Збіг зі production — відмова. Hostname порівнюємо нормалізовано.
if (staging.d1 === prod.d1) fail("STAGING_D1_DATABASE_ID equals the production D1 id. Staging must use its own database.");
if (staging.bucket === prod.bucket) fail("STAGING_R2_BUCKET equals the production R2 bucket. Staging must use its own bucket.");
if (normHost(staging.host) === normHost(prod.host)) fail("STAGING_HOSTNAME resolves to the production hostname. Staging must use its own domain.");

const summary = [
  "staging preflight: OK — staging values are distinct from production.",
  `  D1 id:    staging ≠ production`,
  `  R2 bucket: staging ≠ production`,
  `  hostname:  staging ≠ production (normalized compare)`,
].join("\n");
console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, "### Staging preflight\n\n- Staging D1 id / R2 bucket / hostname confirmed distinct from production (fail-closed check).\n");
  } catch { /* summary is best-effort */ }
}
