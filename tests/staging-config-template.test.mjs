// Шаблон staging-конфігу (wrangler.staging.example.toml) і захист від
// незаміненого плейсхолдера D1 id у спільному міграційному виконавці.

import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const PROD_D1_ID = "9013ef37-c262-409b-b15e-235e0899313e";

test("staging example keeps the placeholder and never copies the production D1 id", async () => {
  const example = await read("wrangler.staging.example.toml");
  assert.match(example, /database_id = "REPLACE_WITH_STAGING_D1_ID"/, "placeholder must remain");
  assert.doesNotMatch(example, new RegExp(PROD_D1_ID), "must not copy the production database_id");
  assert.doesNotMatch(example, /radiologyos\.tech/, "must not reuse the production hostname");
  assert.match(example, /database_name = "radiologyos-staging"/, "staging uses its own D1 name");
});

test("staging instructions require explicitly naming the staging config", async () => {
  const example = await read("wrangler.staging.example.toml");
  assert.match(example, /apply-d1-migrations-remote\.sh radiologyos-staging wrangler\.staging\.toml drizzle/);
  assert.match(example, /--config wrangler\.staging\.toml/);
});

test("the example is a template, not an active deploy config (not named wrangler.staging.toml)", async () => {
  // Файл-приклад не має підхоплюватись як робочий конфіг автоматично.
  await assert.rejects(read("wrangler.staging.toml"), "active staging config must be created by the team, not committed");
});

test("migration executor fails closed on an unreplaced D1 id placeholder before any D1 call", async () => {
  const scriptPath = fileURLToPath(new URL("../scripts/apply-d1-migrations-remote.sh", import.meta.url));
  const dir = await mkdtemp(path.join(tmpdir(), "stg-"));
  const migDir = path.join(dir, "drizzle");
  await mkdir(migDir);
  await writeFile(path.join(migDir, "0001_x.sql"), "SELECT 1;\n");
  const cfg = path.join(dir, "wrangler.staging.toml");
  await writeFile(cfg, 'database_id = "REPLACE_WITH_STAGING_D1_ID"\n');

  const result = spawnSync("bash", [scriptPath, "radiologyos-staging", cfg, migDir], { encoding: "utf8" });
  assert.notEqual(result.status, 0, "must exit non-zero when the placeholder remains");
  assert.match(result.stderr, /placeholder D1 database id|REPLACE_WITH_STAGING_D1_ID/i);
});

test("guard rejects a non-production config that carries the production D1 id", async () => {
  const scriptPath = fileURLToPath(new URL("../scripts/apply-d1-migrations-remote.sh", import.meta.url));
  const prodConfig = await read("wrangler.cloudflare.toml");
  const prodId = /database_id\s*=\s*"([^"]+)"/.exec(prodConfig)[1];

  const dir = await mkdtemp(path.join(tmpdir(), "stg-"));
  const migDir = path.join(dir, "drizzle");
  await mkdir(migDir);
  await writeFile(path.join(migDir, "0001_x.sql"), "SELECT 1;\n");
  const cfg = path.join(dir, "wrangler.staging.toml");
  // name matches the selected DATABASE (so guard 1 passes) but id is production's.
  await writeFile(cfg, `database_name = "radiologyos-staging"\ndatabase_id = "${prodId}"\n`);

  const result = spawnSync("bash", [scriptPath, "radiologyos-staging", cfg, migDir], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  assert.notEqual(result.status, 0, "must refuse a staging config pointing at the production D1 id");
  assert.match(result.stderr, /PRODUCTION D1 id/);
});

test("guard rejects a selected database that disagrees with the config's database_name", async () => {
  const scriptPath = fileURLToPath(new URL("../scripts/apply-d1-migrations-remote.sh", import.meta.url));
  const dir = await mkdtemp(path.join(tmpdir(), "stg-"));
  const migDir = path.join(dir, "drizzle");
  await mkdir(migDir);
  await writeFile(path.join(migDir, "0001_x.sql"), "SELECT 1;\n");
  const cfg = path.join(dir, "wrangler.staging.toml");
  await writeFile(cfg, 'database_name = "radiologyos"\ndatabase_id = "00000000-aaaa-bbbb-cccc-000000000000"\n');

  // Caller asks to migrate radiologyos-staging but the config declares radiologyos.
  const result = spawnSync("bash", [scriptPath, "radiologyos-staging", cfg, migDir], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  assert.notEqual(result.status, 0, "must refuse when arg and config database_name disagree");
  assert.match(result.stderr, /does not match database_name/);
});

test("a well-formed staging config (own id, matching name) passes the config guards", async () => {
  const scriptPath = fileURLToPath(new URL("../scripts/apply-d1-migrations-remote.sh", import.meta.url));
  const dir = await mkdtemp(path.join(tmpdir(), "stg-"));
  const migDir = path.join(dir, "drizzle");
  await mkdir(migDir);
  const cfg = path.join(dir, "wrangler.staging.toml");
  await writeFile(cfg, 'database_name = "radiologyos-staging"\ndatabase_id = "11111111-2222-3333-4444-555555555555"\n');

  const result = spawnSync("bash", [scriptPath, "radiologyos-staging", cfg, migDir], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  // It will fail later reaching wrangler/npx, but NOT with any config-guard refusal.
  assert.doesNotMatch(result.stderr, /PRODUCTION D1 id|does not match database_name|placeholder D1 database_id/);
});

test("the placeholder guard lives in the shared executor and the script stays valid bash", async () => {
  const script = await read("scripts/apply-d1-migrations-remote.sh");
  assert.match(script, /REPLACE_WITH_\[A-Z_\]\*D1\[A-Z_\]\*ID/, "guard regex covers prod + staging placeholders");
  const syntax = spawnSync("bash", ["-n", fileURLToPath(new URL("../scripts/apply-d1-migrations-remote.sh", import.meta.url))], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});
