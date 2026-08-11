import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("local deploy uses valid remote D1 command contracts", async () => {
  const script = await read("scripts/deploy-cloudflare.sh");

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
    /wrangler d1 migrations apply radiologyos --remote --config \"\$\{CONFIG\}\"/,
    "Migration application must remain explicitly remote",
  );
});

test("GitHub production workflow uses the same Time Travel command contract", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  assert.match(workflow, /wrangler d1 time-travel info radiologyos --config wrangler\.cloudflare\.toml/);
  assert.doesNotMatch(workflow, /wrangler d1 time-travel info[^\n]*--remote/);
});

test("GitHub production smoke test verifies a Worker + D1 read", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  assert.match(
    workflow,
    /https:\/\/radiologyos\.tech\/api\/public-services > \/tmp\/radiologyos-public-services\.json/,
  );
  assert.match(workflow, /Array\.isArray\(payload\?\.services\)/);
});
