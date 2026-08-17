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
  db.close();

  await rm(artifactDir, { recursive: true, force: true });
  const drizzleKit = resolve(root, "node_modules/.bin/drizzle-kit");
  const result = spawnSync(drizzleKit, [
    "pull",
    "--init",
    "--dialect=sqlite",
    `--url=${dbPath}`,
    `--out=${artifactDir}`,
    "--introspect-casing=camel",
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) throw new Error(`drizzle-kit pull failed with exit code ${result.status}`);

  const files = (await readdir(artifactDir, { recursive: true })).sort();
  console.log(`Rebaseline source: ${migrations.at(-1)} (${migrations.length} committed migrations)`);
  console.log(`Artifact files: ${files.join(", ")}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
