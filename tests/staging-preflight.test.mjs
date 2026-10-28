// Staging preflight: staging-значення мають відрізнятись від production, інакше
// fail-closed. Production-значення читаються з wrangler.cloudflare.toml.

import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../scripts/staging-preflight.mjs", import.meta.url));
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function prodValues() {
  const cfg = await read("wrangler.cloudflare.toml");
  return {
    d1: /database_id\s*=\s*"([^"]+)"/.exec(cfg)[1],
    bucket: /bucket_name\s*=\s*"([^"]+)"/.exec(cfg)[1],
    host: /pattern\s*=\s*"([^"]+)"/.exec(cfg)[1],
  };
}

function run(env, extraArgs = []) {
  return spawnSync("node", [SCRIPT, ...extraArgs], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

const SAFE = {
  STAGING_D1_DATABASE_ID: "11111111-2222-3333-4444-555555555555",
  STAGING_R2_BUCKET: "radiologyos-staging-printed-forms",
  STAGING_HOSTNAME: "staging.example",
};

test("passes when all staging values are distinct from production", async () => {
  const r = run(SAFE);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /OK/);
});

test("fails when staging D1 id equals production", async () => {
  const prod = await prodValues();
  const r = run({ ...SAFE, STAGING_D1_DATABASE_ID: prod.d1 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /D1 database id|equals the production D1 id/i);
});

test("fails when staging R2 bucket equals production", async () => {
  const prod = await prodValues();
  const r = run({ ...SAFE, STAGING_R2_BUCKET: prod.bucket });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /R2 bucket/i);
});

test("fails when staging hostname equals production regardless of case/scheme/slash", async () => {
  const prod = await prodValues();
  const variants = [
    prod.host.toUpperCase(),
    `https://${prod.host}`,
    `${prod.host}/`,
    `HTTPS://${prod.host.toUpperCase()}/`,
  ];
  for (const host of variants) {
    const r = run({ ...SAFE, STAGING_HOSTNAME: host });
    assert.equal(r.status, 1, `variant must be rejected: ${host}`);
    assert.match(r.stderr, /production hostname/i);
  }
});

test("a genuinely different staging hostname is accepted", async () => {
  const prod = await prodValues();
  const r = run({ ...SAFE, STAGING_HOSTNAME: `staging.${prod.host}` });
  assert.equal(r.status, 0, r.stderr);
});

test("fail-closed on a missing staging value", () => {
  const r = run({ ...SAFE, STAGING_HOSTNAME: "" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing staging value|STAGING_HOSTNAME/i);
});

test("fail-closed on a placeholder staging value", () => {
  const r = run({ ...SAFE, STAGING_D1_DATABASE_ID: "REPLACE_WITH_STAGING_D1_ID" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /placeholder/i);
});

test("fail-closed when the production config cannot be read", () => {
  const r = run(SAFE, ["--prod-config", "does-not-exist.toml"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot read production config/i);
});

test("fail-closed when a production value cannot be determined from the config", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pf-"));
  const cfg = path.join(dir, "wrangler.cloudflare.toml");
  // Конфіг без database_id — production-значення не визначається.
  await writeFile(cfg, 'name = "radiologyos"\nbucket_name = "radiologyos-printed-forms"\nroutes = [ { pattern = "radiologyos.tech" } ]\n');
  const r = run(SAFE, ["--prod-config", cfg]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /could not determine production D1 database_id/i);
});

test("never prints credentials present in the environment", async () => {
  const prod = await prodValues();
  // Навіть у разі відмови (збіг) токен/акаунт у середовищі не повинні витекти в логи.
  const r = run({
    ...SAFE,
    STAGING_D1_DATABASE_ID: prod.d1,
    CLOUDFLARE_API_TOKEN: "SENTINEL_TOKEN_SHOULD_NOT_APPEAR",
    CLOUDFLARE_ACCOUNT_ID: "SENTINEL_ACCOUNT_SHOULD_NOT_APPEAR",
  });
  const combined = `${r.stdout}\n${r.stderr}`;
  assert.doesNotMatch(combined, /SENTINEL_TOKEN_SHOULD_NOT_APPEAR/);
  assert.doesNotMatch(combined, /SENTINEL_ACCOUNT_SHOULD_NOT_APPEAR/);
});
