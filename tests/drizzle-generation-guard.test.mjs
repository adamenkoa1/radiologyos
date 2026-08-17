import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const migrationFiles = async () => (await readdir(fileURLToPath(new URL("drizzle/", root))))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

test("db:generate stays guarded and is a no-op after Drizzle metadata rebaseline", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["db:generate"], "node scripts/db-generate-guard.mjs");

  const beforeMigrations = await migrationFiles();
  const latestMigration = beforeMigrations.at(-1).replace(/\.sql$/, "");
  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  const latestJournal = String(journal.entries.at(-1)?.tag || "");
  assert.equal(latestJournal, latestMigration, "Drizzle journal must track the latest committed SQL migration");

  const expectedSnapshot = `${latestMigration.slice(0, 4)}_snapshot.json`;
  const snapshots = (await readdir(fileURLToPath(new URL("drizzle/meta/", root))))
    .filter((name) => /^\d{4}_snapshot\.json$/.test(name));
  assert.ok(snapshots.includes(expectedSnapshot), `missing current Drizzle snapshot ${expectedSnapshot}`);

  const result = spawnSync(process.execPath, ["scripts/db-generate-guard.mjs"], {
    cwd:fileURLToPath(root),
    encoding:"utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const afterMigrations = await migrationFiles();
  assert.deepEqual(afterMigrations, beforeMigrations, "guarded drizzle-kit generate must not create schema drift");
  assert.match(`${result.stdout}\n${result.stderr}`, /No schema changes, nothing to migrate/i);
});

test("production deploy applies committed SQL migrations directly instead of generating schema", async () => {
  const [deploy, migrationExecutor] = await Promise.all([
    read("scripts/deploy-cloudflare.sh"),
    read("scripts/apply-d1-migrations-remote.sh"),
  ]);
  assert.match(
    deploy,
    /bash scripts\/apply-d1-migrations-remote\.sh radiologyos \"\$\{CONFIG\}\" drizzle/,
  );
  assert.match(
    migrationExecutor,
    /cat \"\$\{MIGRATIONS_DIR\}\/\$\{name\}\" > \"\$\{IMPORT_FILE\}\"/,
    "the executor must import committed migration SQL files directly",
  );
  assert.match(
    migrationExecutor,
    /wrangler d1 execute \"\$\{DATABASE\}\" --remote --config \"\$\{CONFIG\}\" --file \"\$\{IMPORT_FILE\}\"/,
  );
  assert.doesNotMatch(`${deploy}\n${migrationExecutor}`, /db:generate|drizzle-kit generate/);
});
