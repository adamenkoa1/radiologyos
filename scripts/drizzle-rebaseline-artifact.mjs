import { DatabaseSync } from "node:sqlite";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const drizzleDir = join(root, "drizzle");
const artifactDir = join(root, ".drizzle-rebaseline-artifact");
const artifactMetaDir = join(artifactDir, "meta");
const workDir = await mkdtemp(join(tmpdir(), "radiologyos-drizzle-rebaseline-"));
const dbPath = join(workDir, "migrated.sqlite");
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const run = (command, args) => spawnSync(command, args, {
  cwd: root,
  encoding: "utf8",
  stdio: "pipe",
  env: { ...process.env, CI: "true" },
});
const printResult = (result) => {
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
};

try {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  const migrations = (await readdir(drizzleDir))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  if (!migrations.length) throw new Error("No committed SQL migrations found");
  const latestMigration = migrations.at(-1);
  const latestTag = latestMigration.slice(0, -4);
  const latestPrefix = latestTag.slice(0, 4);
  const latestIndex = Number(latestPrefix);
  if (!Number.isInteger(latestIndex)) throw new Error(`Invalid latest migration prefix: ${latestPrefix}`);

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
  const pull = run(drizzleKit, [
    "pull",
    "--dialect=sqlite",
    `--url=${dbPath}`,
    `--out=${artifactDir}`,
    "--introspect-casing=camel",
  ]);
  printResult(pull);
  if (pull.status !== 0) throw new Error(`drizzle-kit pull failed with exit code ${pull.status}`);

  // drizzle-kit 0.31.10 emits SQL expression defaults as quoted strings and
  // mis-serializes raw CHECK expressions. Raw CHECKs remain authoritative in
  // committed SQL migrations; the declarative baseline intentionally covers
  // tables, columns, indexes, unique constraints and foreign keys only.
  const generatedSchemaPath = join(artifactDir, "schema.ts");
  let generatedSchema = await readFile(generatedSchemaPath, "utf8");
  generatedSchema = generatedSchema
    .replaceAll('.default("sql`(CURRENT_TIMESTAMP)`")', '.default(sql`(CURRENT_TIMESTAMP)`)')
    .replaceAll(
      '.default("sql`(lower(hex(randomblob(16))))`")',
      '.default(sql`(lower(hex(randomblob(16))))`)',
    )
    .replace(", check,", ",")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("check("))
    .join("\n");
  await writeFile(generatedSchemaPath, generatedSchema);

  const pulledSnapshot = join(artifactMetaDir, "0000_snapshot.json");
  const snapshot = JSON.parse(await readFile(pulledSnapshot, "utf8"));
  for (const table of Object.values(snapshot.tables || {})) table.checkConstraints = {};
  await writeFile(pulledSnapshot, `${JSON.stringify(snapshot, null, 2)}\n`);

  // Convert drizzle-kit pull's synthetic 0000 metadata into a baseline anchored
  // to the latest real committed migration. idx=89 deliberately preserves the
  // historical missing 0085 filename and makes the next generated migration 0090.
  const baselineSnapshot = join(artifactMetaDir, `${latestPrefix}_snapshot.json`);
  await rename(pulledSnapshot, baselineSnapshot);
  const gitTime = run("git", ["log", "-1", "--format=%ct", "--", `drizzle/${latestMigration}`]);
  const whenSeconds = Number(String(gitTime.stdout || "").trim());
  const journal = {
    version: "7",
    dialect: "sqlite",
    entries: [{
      idx: latestIndex,
      version: "6",
      when: Number.isFinite(whenSeconds) && whenSeconds > 0 ? whenSeconds * 1000 : 0,
      tag: latestTag,
      breakpoints: true,
    }],
  };
  await writeFile(join(artifactMetaDir, "_journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
  for (const name of await readdir(artifactDir)) {
    if (name.endsWith(".sql")) await unlink(join(artifactDir, name));
  }
  await rm(join(artifactDir, "relations.ts"), { force: true });

  // Stage the generated declarations and baseline metadata in this disposable
  // CI checkout. Normal lint/type/build/tests below therefore validate exactly
  // what will later be committed, while production and committed SQL stay untouched.
  await copyFile(generatedSchemaPath, join(root, "db/schema.ts"));
  await rm(join(drizzleDir, "meta"), { recursive: true, force: true });
  await mkdir(join(drizzleDir, "meta"), { recursive: true });
  await copyFile(baselineSnapshot, join(drizzleDir, "meta", `${latestPrefix}_snapshot.json`));
  await copyFile(join(artifactMetaDir, "_journal.json"), join(drizzleDir, "meta", "_journal.json"));

  const eslint = resolve(root, "node_modules/.bin/eslint");
  const lintFix = run(eslint, ["--fix", "db/schema.ts"]);
  printResult(lintFix);
  if (lintFix.status !== 0) throw new Error(`eslint --fix db/schema.ts failed with exit code ${lintFix.status}`);
  await copyFile(join(root, "db/schema.ts"), generatedSchemaPath);

  const beforeSql = new Set((await readdir(drizzleDir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)));
  console.log("--- drizzle generate no-op proof ---");
  const generate = run(drizzleKit, ["generate"]);
  printResult(generate);
  if (generate.status !== 0) throw new Error(`drizzle-kit generate failed with exit code ${generate.status}`);
  const afterSql = (await readdir(drizzleDir)).filter((name) => /^\d{4}_.+\.sql$/.test(name));
  const generatedMigrations = afterSql.filter((name) => !beforeSql.has(name));
  if (generatedMigrations.length) {
    throw new Error(`Rebaseline is not a no-op; generated: ${generatedMigrations.join(", ")}`);
  }

  const files = (await readdir(artifactDir, { recursive: true })).sort();
  console.log(`Rebaseline source: ${latestMigration} (${migrations.length} committed migrations)`);
  console.log(`Baseline journal idx: ${latestIndex}; next expected migration: ${String(latestIndex + 1).padStart(4, "0")}`);
  console.log(`Artifact files: ${files.join(", ")}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
