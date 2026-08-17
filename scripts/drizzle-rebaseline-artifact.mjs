import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const drizzleDir = join(root, "drizzle");
const artifactDir = join(root, ".drizzle-rebaseline-artifact");
const workDir = await mkdtemp(join(tmpdir(), "radiologyos-drizzle-rebaseline-"));
const dbPath = join(workDir, "migrated.sqlite");
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

try {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  const migrations = (await readdir(drizzleDir))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  if (!migrations.length) throw new Error("No committed SQL migrations found");
  for (const migration of migrations) {
    const sql = await readFile(join(drizzleDir, migration), "utf8");
    try {
      db.exec(sql);
    } catch (error) {
      throw new Error(`${migration}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // drizzle-kit 0.31.10 cannot introspect the repository's raw-SQL views.
  // They remain authoritative in committed migrations; remove them only from
  // this disposable database copy so table/index/FK introspection can finish.
  const views = db.prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name").all();
  console.log(`Raw SQL views excluded from Drizzle pull: ${views.map(({ name }) => name).join(", ") || "none"}`);
  for (const { name } of views) db.exec(`DROP VIEW ${quoteIdentifier(name)}`);
  db.close();

  await rm(artifactDir, { recursive: true, force: true });
  const drizzleKit = resolve(root, "node_modules/.bin/drizzle-kit");
  const pull = spawnSync(drizzleKit, [
    "pull",
    "--dialect=sqlite",
    `--url=${dbPath}`,
    `--out=${artifactDir}`,
    "--introspect-casing=camel",
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  process.stdout.write(pull.stdout || "");
  process.stderr.write(pull.stderr || "");
  if (pull.status !== 0) throw new Error(`drizzle-kit pull failed with exit code ${pull.status}`);

  // Compare the checked-in application schema against the introspected D1
  // snapshot. Any generated 0001 migration is evidence of schema.ts drift and
  // is intentionally kept in the artifact for review; no production state is
  // touched by this diagnostic generate.
  const generate = spawnSync(drizzleKit, [
    "generate",
    "--dialect=sqlite",
    "--schema=./db/schema.ts",
    "--out=.drizzle-rebaseline-artifact",
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, CI: "true" },
  });
  console.log("--- drizzle generate against introspected baseline ---");
  process.stdout.write(generate.stdout || "");
  process.stderr.write(generate.stderr || "");
  if (generate.status !== 0) throw new Error(`drizzle-kit generate failed with exit code ${generate.status}`);

  const files = (await readdir(artifactDir, { recursive: true })).sort();
  console.log(`Rebaseline source: ${migrations.at(-1)} (${migrations.length} committed migrations)`);
  console.log(`Artifact files: ${files.join(", ")}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
