import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("db:generate fails closed while Drizzle metadata trails committed SQL migrations", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["db:generate"], "node scripts/db-generate-guard.mjs");

  const migrationFiles = (await readdir(fileURLToPath(new URL("drizzle/", root))))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const latestMigration = migrationFiles.at(-1).replace(/\.sql$/, "");
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  const latestJournal = String(journal.entries.at(-1)?.tag || "");
  assert.notEqual(latestJournal, latestMigration,
    "this guard test should be removed/changed after Drizzle metadata is fully rebaselined");

  const result = spawnSync(process.execPath, ["scripts/db-generate-guard.mjs"], {
    cwd:fileURLToPath(root),
    encoding:"utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /migration metadata is stale/i);
  assert.match(result.stderr, new RegExp(`Latest SQL migration: ${latestMigration}`));
  assert.match(result.stderr, new RegExp(`Latest journal entry: ${latestJournal}`));
  assert.match(result.stderr, /Do not run drizzle-kit generate until the full migration history has been rebaselined/i);
});

test("production deploy applies committed SQL migrations directly instead of generating schema", async () => {
  const deploy = await read("scripts/deploy-cloudflare.sh");
  assert.match(deploy, /wrangler d1 migrations apply radiologyos --remote/);
  assert.doesNotMatch(deploy, /db:generate|drizzle-kit generate/);
});
