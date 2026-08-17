import { copyFile, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const drizzleDir = join(root, "drizzle");
const artifactDir = join(root, ".drizzle-rebaseline-artifact");
const artifactMetaDir = join(artifactDir, "meta");
const drizzleMetaDir = join(drizzleDir, "meta");
const drizzleKit = resolve(root, "node_modules/.bin/drizzle-kit");
const migrationPattern = /^\d{4}_.+\.sql$/;

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

const listMigrations = async () => (await readdir(drizzleDir)).filter((name) => migrationPattern.test(name)).sort();
const committedMigrations = await listMigrations();
const beforeSql = new Set(committedMigrations);
const firstPass = run(process.execPath, [join(root, "scripts", "drizzle-rebaseline-artifact.mjs")]);
printResult(firstPass);

if (firstPass.status === 0) {
  console.log("Rebaseline converged on the first generate pass.");
  process.exit(0);
}

const artifactJournalPath = join(artifactMetaDir, "_journal.json");
let initialJournal;
try {
  initialJournal = JSON.parse(await readFile(artifactJournalPath, "utf8"));
} catch (error) {
  throw new Error(`Initial rebaseline failed before producing baseline metadata: ${error instanceof Error ? error.message : String(error)}`);
}

const initialBaselineEntry = Array.isArray(initialJournal.entries) ? initialJournal.entries.at(-1) : null;
if (!initialBaselineEntry || !Number.isInteger(initialBaselineEntry.idx) || typeof initialBaselineEntry.tag !== "string") {
  throw new Error("Initial rebaseline did not produce a valid baseline journal entry");
}

// Reconstruct journal provenance for every committed SQL migration. Numeric idx
// values follow the historical file prefixes exactly, including the intentional
// 0085 gap; no applied migration is rewritten or renumbered.
const journalEntries = committedMigrations.map((name) => {
  const tag = name.slice(0, -4);
  const idx = Number(tag.slice(0, 4));
  if (!Number.isInteger(idx)) throw new Error(`Invalid migration prefix: ${name}`);
  const gitTime = run("git", ["log", "-1", "--format=%ct", "--", `drizzle/${name}`]);
  const whenSeconds = Number(String(gitTime.stdout || "").trim());
  if (!Number.isFinite(whenSeconds) || whenSeconds <= 0) {
    throw new Error(`Unable to recover commit timestamp for drizzle/${name}; full git history is required`);
  }
  return {
    idx,
    version: "6",
    when: whenSeconds * 1000,
    tag,
    breakpoints: true,
  };
});
const journal = {
  version: "7",
  dialect: "sqlite",
  entries: journalEntries,
};
await writeFile(artifactJournalPath, `${JSON.stringify(journal, null, 2)}\n`);

const baselineEntry = journalEntries.at(-1);
const baselinePrefix = String(baselineEntry.idx).padStart(4, "0");
const expectedNextPrefix = String(baselineEntry.idx + 1).padStart(4, "0");
const afterFirstPass = await listMigrations();
const firstPassDrift = afterFirstPass.filter((name) => !beforeSql.has(name));
if (firstPassDrift.length !== 1 || !firstPassDrift[0].startsWith(`${expectedNextPrefix}_`)) {
  throw new Error(
    `Initial rebaseline failed for an unexpected reason; generated migrations: ${firstPassDrift.join(", ") || "none"}`,
  );
}

const driftMigration = firstPassDrift[0];
const driftSnapshot = join(drizzleMetaDir, `${expectedNextPrefix}_snapshot.json`);
const baselineSnapshot = join(drizzleMetaDir, `${baselinePrefix}_snapshot.json`);
const artifactBaselineSnapshot = join(artifactMetaDir, `${baselinePrefix}_snapshot.json`);

try {
  await readFile(driftSnapshot, "utf8");
} catch (error) {
  throw new Error(`Expected Drizzle target snapshot ${expectedNextPrefix}_snapshot.json is missing: ${error instanceof Error ? error.message : String(error)}`);
}

// drizzle-kit pull and generate normalize CHECK constraints, partial-index predicates,
// and some SQLite defaults differently. The first generated snapshot is therefore
// the canonical Drizzle representation of the reconstructed schema. Promote that
// representation to the baseline, discard the synthetic SQL drift, and prove that
// a second generate is a true no-op before the artifact can be committed.
await copyFile(driftSnapshot, baselineSnapshot);
await copyFile(driftSnapshot, artifactBaselineSnapshot);
await rm(join(drizzleDir, driftMigration), { force: true });
await rm(driftSnapshot, { force: true });
await writeFile(join(drizzleMetaDir, "_journal.json"), `${JSON.stringify(journal, null, 2)}\n`);

console.log(`Reconstructed journal provenance for ${journalEntries.length} committed migrations.`);
console.log(`Promoted ${expectedNextPrefix}_snapshot.json to ${baselinePrefix}_snapshot.json for Drizzle metadata convergence.`);
console.log("--- drizzle generate convergence proof ---");
const secondPass = run(drizzleKit, ["generate"]);
printResult(secondPass);
if (secondPass.status !== 0) {
  throw new Error(`Second drizzle-kit generate failed with exit code ${secondPass.status}`);
}

const afterSecondPass = await listMigrations();
const secondPassDrift = afterSecondPass.filter((name) => !beforeSql.has(name));
if (secondPassDrift.length) {
  for (const name of secondPassDrift) {
    await copyFile(join(drizzleDir, name), join(artifactDir, `convergence-drift-${name}`));
    const prefix = name.slice(0, 4);
    try {
      await copyFile(join(drizzleMetaDir, `${prefix}_snapshot.json`), join(artifactDir, `convergence-drift-${prefix}_snapshot.json`));
    } catch {
      // The SQL diff is enough for diagnostics when no snapshot was emitted.
    }
  }
  throw new Error(`Rebaseline still drifts after snapshot promotion: ${secondPassDrift.join(", ")}`);
}

console.log(`Drizzle metadata converged at ${baselineEntry.tag}; next generated migration remains ${expectedNextPrefix}.`);
