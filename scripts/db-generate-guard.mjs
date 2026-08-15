import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const drizzleDir = new URL("drizzle/", root);
const metaDir = new URL("drizzle/meta/", root);

function migrationTag(name) {
  return name.replace(/\.sql$/i, "");
}

async function state() {
  const files = (await readdir(fileURLToPath(drizzleDir)))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  if (!files.length) throw new Error("No SQL migrations found in drizzle/");

  const latestMigration = migrationTag(files.at(-1));
  const journal = JSON.parse(await readFile(new URL("_journal.json", metaDir), "utf8"));
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  const latestJournal = entries.length ? String(entries.at(-1)?.tag || "") : "";
  const snapshots = (await readdir(fileURLToPath(metaDir)))
    .filter((name) => /^\d{4}_snapshot\.json$/.test(name))
    .sort();
  const expectedSnapshot = `${latestMigration.slice(0,4)}_snapshot.json`;

  return {
    latestMigration,
    latestJournal,
    expectedSnapshot,
    hasLatestSnapshot:snapshots.includes(expectedSnapshot),
  };
}

async function main() {
  const current = await state();
  if (current.latestJournal !== current.latestMigration || !current.hasLatestSnapshot) {
    console.error("Drizzle schema generation is blocked: migration metadata is stale.");
    console.error(`Latest SQL migration: ${current.latestMigration}`);
    console.error(`Latest journal entry: ${current.latestJournal || "<none>"}`);
    console.error(`Required current snapshot: drizzle/meta/${current.expectedSnapshot}`);
    console.error("Do not run drizzle-kit generate until the full migration history has been rebaselined into Drizzle metadata.");
    console.error("Production deployment is unaffected: it applies committed SQL migrations with wrangler d1 migrations apply.");
    process.exit(1);
  }

  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["exec", "drizzle-kit", "generate"], {
    cwd:fileURLToPath(root),
    stdio:"inherit",
    shell:false,
  });
  child.on("error", (error) => {
    console.error(`Unable to start drizzle-kit: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`drizzle-kit terminated by ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

await main();
