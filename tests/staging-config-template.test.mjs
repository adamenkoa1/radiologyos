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

test("the placeholder guard lives in the shared executor and the script stays valid bash", async () => {
  const script = await read("scripts/apply-d1-migrations-remote.sh");
  assert.match(script, /REPLACE_WITH_\[A-Z_\]\*D1\[A-Z_\]\*ID/, "guard regex covers prod + staging placeholders");
  const syntax = spawnSync("bash", ["-n", fileURLToPath(new URL("../scripts/apply-d1-migrations-remote.sh", import.meta.url))], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});
