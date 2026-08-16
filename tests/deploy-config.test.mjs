import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("local deploy uses valid remote D1 command contracts", async () => {
  const [script, migrationScript] = await Promise.all([
    read("scripts/deploy-cloudflare.sh"),
    read("scripts/apply-d1-migrations-remote.sh"),
  ]);

  assert.match(
    script,
    /wrangler d1 time-travel info radiologyos --config \"\$\{CONFIG\}\"/,
    "Time Travel info is remote-only and must not receive --remote",
  );
  assert.doesNotMatch(
    script,
    /wrangler d1 time-travel info[^\n]*--remote/,
    "Do not reintroduce the unsupported --remote option on Time Travel info",
  );
  assert.match(
    script,
    /bash scripts\/apply-d1-migrations-remote\.sh radiologyos \"\$\{CONFIG\}\" drizzle/,
    "Local deploy must use the shared remote D1 migration executor",
  );
  assert.match(
    migrationScript,
    /wrangler d1 execute \"\$\{DATABASE\}\" --remote --config \"\$\{CONFIG\}\" --file \"\$\{IMPORT_FILE\}\"/,
    "Remote migrations must use Wrangler's file-import execution path",
  );
  assert.doesNotMatch(
    `${script}\n${migrationScript}`,
    /wrangler d1 migrations apply/,
    "Deployment must not return to the remote /query migration path that fails on valid trigger bodies",
  );
});

test("remote D1 migration executor keeps migration tracking in the imported SQL file", async () => {
  const script = await read("scripts/apply-d1-migrations-remote.sh");
  const copySql = script.indexOf('cat "${MIGRATIONS_DIR}/${name}" > "${IMPORT_FILE}"');
  const tracking = script.indexOf("INSERT INTO d1_migrations (name) VALUES ('%s');");
  const executeFile = script.indexOf('--file "${IMPORT_FILE}"');
  const verifyRegistry = script.indexOf("SELECT COUNT(*) AS applied FROM d1_migrations WHERE name='${name}';");

  assert.notEqual(copySql, -1, "migration SQL must be copied unchanged into the import file");
  assert.notEqual(tracking, -1, "migration registry insert must be appended to the import file");
  assert.notEqual(executeFile, -1, "the combined SQL file must be sent through --file");
  assert.notEqual(verifyRegistry, -1, "the registry must be verified after each imported migration");
  assert.ok(copySql < tracking && tracking < executeFile && executeFile < verifyRegistry);
  assert.match(script, /Unsafe D1 migration filename/);
  assert.match(script, /still unapplied/);
});

test("remote D1 migration executor has valid bash syntax", () => {
  const path = fileURLToPath(new URL("../scripts/apply-d1-migrations-remote.sh", import.meta.url));
  const result = spawnSync("bash", ["-n", path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("deployment paths preserve runtime Worker vars", async () => {
  const [script, workflow] = await Promise.all([
    read("scripts/deploy-cloudflare.sh"),
    read(".github/workflows/deploy.yml"),
  ]);
  assert.match(
    script,
    /wrangler deploy --keep-vars --config \"\$\{CONFIG\}\"/,
    "Local deploy must preserve remote Worker vars such as OUTBOUND_ALLOWED_HOSTS",
  );
  assert.match(
    workflow,
    /wrangler deploy --keep-vars --config wrangler\.cloudflare\.toml/,
    "Production workflow must preserve remote Worker vars such as OUTBOUND_ALLOWED_HOSTS",
  );
});

test("production Worker keeps custom routes outside the triggers table", async () => {
  const config = await read("wrangler.cloudflare.toml");
  const triggerMatch = /^\[triggers\]$/m.exec(config);
  const routesMatch = /^routes\s*=\s*\[$/m.exec(config);
  assert.ok(routesMatch?.index != null, "custom-domain routes must be configured");
  assert.ok(triggerMatch?.index != null, "cron trigger table must be configured");
  assert.ok(routesMatch.index < triggerMatch.index, "routes must remain top-level, before [triggers]");

  const assetsMatch = /^\[assets\]$/m.exec(config.slice(triggerMatch.index));
  const triggerEnd = assetsMatch ? triggerMatch.index + assetsMatch.index : config.length;
  const triggerBlock = config.slice(triggerMatch.index, triggerEnd);
  assert.doesNotMatch(triggerBlock, /^routes\s*=/m, "routes must not be nested inside [triggers]");
});

test("production Worker schedules patient reminder evaluation every 15 minutes", async () => {
  const config = await read("wrangler.cloudflare.toml");
  assert.match(config, /\[triggers\][\s\S]*crons\s*=\s*\[\s*"\*\/15 \* \* \* \*"\s*\]/);
});

test("GitHub production workflow uses the same Time Travel command contract", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  assert.match(workflow, /wrangler d1 time-travel info radiologyos --config wrangler\.cloudflare\.toml/);
  assert.doesNotMatch(workflow, /wrangler d1 time-travel info[^\n]*--remote/);
  assert.match(
    workflow,
    /bash scripts\/apply-d1-migrations-remote\.sh radiologyos wrangler\.cloudflare\.toml drizzle/,
  );
});

test("production deploy paths reject placeholder or malformed administrator hashes", async () => {
  const [script, workflow] = await Promise.all([
    read("scripts/deploy-cloudflare.sh"),
    read(".github/workflows/deploy.yml"),
  ]);
  for (const source of [script, workflow]) {
    assert.match(source, /substr\(password_hash,15,instr\(substr\(password_hash,15\),'\$'\)-1\) AS iterations/);
    assert.match(source, /substr\(password_hash,1,14\) = 'pbkdf2\$sha256\$'/);
    assert.match(source, /length\(password_hash\) - length\(replace\(password_hash,'\$',''\)\) = 4/);
    assert.match(source, /iterations NOT GLOB '\*\[\^0-9\]\*'/);
    assert.match(source, /CAST\(iterations AS INTEGER\) >= 1000/);
    assert.match(source, /length\(password_hash\) >= 80/);
    assert.match(source, /secure_admins/);
    assert.match(source, /ADMIN_GUARD_SQL=\$\(cat <<'SQL'/);
    assert.match(source, /--command \"\$ADMIN_GUARD_SQL\"/);
    assert.doesNotMatch(source, /--command \"WITH admins AS/);
  }
});

test("quoted admin-guard heredoc preserves PBKDF2 dollar literals", () => {
  const command = String.raw`ADMIN_GUARD_SQL=$(cat <<'SQL'
SELECT 'pbkdf2$sha256$100000$seed';
SQL
)
printf '%s' "$ADMIN_GUARD_SQL"`;
  const result = spawnSync("bash", ["-c", command], {
    encoding: "utf8",
    env: { ...process.env, sha256: "BROKEN", seed: "BROKEN" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "SELECT 'pbkdf2$sha256$100000$seed';");
});

test("GitHub production workflow migrates D1 before checking for an administrator", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  const migrations = workflow.indexOf("- name: Apply D1 migrations");
  const adminCheck = workflow.indexOf("- name: Verify a secure active administrator exists");
  assert.notEqual(migrations, -1, "production workflow must apply D1 migrations");
  assert.notEqual(adminCheck, -1, "production workflow must verify a secure administrator");
  assert.ok(migrations < adminCheck, "D1 migrations must run before the admin check on a fresh database");
});

test("GitHub production smoke test verifies a Worker + D1 read", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  assert.match(
    workflow,
    /https:\/\/radiologyos\.tech\/api\/public-services > \/tmp\/radiologyos-public-services\.json/,
  );
  assert.match(workflow, /Array\.isArray\(payload\?\.services\)/);
});
