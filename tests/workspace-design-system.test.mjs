import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("workspace design system is loaded after legacy workspace styles", async () => {
  const globals = await read("app/globals.css");
  const legacy = globals.indexOf('@import "./styles/02-workspace.css";');
  const design = globals.indexOf('@import "./styles/12-design-system.css";');

  assert.notEqual(legacy, -1);
  assert.notEqual(design, -1);
  assert.ok(design > legacy, "design-system overrides must load after legacy workspace CSS");
});

test("staff navigation uses a consistent masked line-icon layer", async () => {
  const css = await read("app/styles/12-design-system.css");

  assert.match(css, /workspaceModuleLink > span\[aria-hidden="true"\]/);
  assert.match(css, /-webkit-mask: var\(--ws-nav-icon\)/);
  assert.match(css, /href="\/staff\/dashboard"/);
  assert.match(css, /href="\/staff\/appointments"/);
  assert.match(css, /href="\/staff\/protocols"/);
  assert.match(css, /href="\/staff\/imaging"/);
  assert.match(css, /href="\/staff\/settings"/);
  assert.match(css, /prefers-reduced-motion/);
});
