import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("protocol workspace exposes a dedicated corrections screen without replacing the original editor", async () => {
  const [layout, subnav, page] = await Promise.all([
    source("app/staff/protocols/layout.tsx"),
    source("app/staff/protocols/protocol-workspace-subnav.tsx"),
    source("app/staff/protocols/corrections/page.tsx"),
  ]);

  assert.match(layout, /ProtocolWorkspaceSubnav/);
  assert.match(subnav, /\/staff\/protocols\/corrections/);
  assert.match(subnav, /href="\/staff\/protocols"/);
  assert.match(page, /documentStatus === "issued" \|\| item\.protocolStatus === "issued"/);
  assert.match(page, /<ProtocolAddendaPanel bookingId=\{selected\.id\}/);
  assert.match(page, /\/staff\/protocols\?open=\$\{selected\.id\}/);
  assert.doesNotMatch(page, /protocols[^\n]*UPDATE|UPDATE protocols/i);
});

test("addendum panel preserves role separation and exact lifecycle actions", async () => {
  const panel = await source("app/staff/protocols/protocol-addenda-panel.tsx");

  assert.match(panel, /fetch\(`\/api\/staff\/protocols\/addenda\?bookingId=\$\{bookingId\}`/);
  assert.match(panel, /method:"POST"/);
  assert.match(panel, /method:"PUT"/);
  assert.match(panel, /staffRole === "radiologist" && selected\?\.status === "ready"/);
  assert.match(panel, /\(staffRole === "radiologist" \|\| staffRole === "admin"\) && selected\?\.status === "signed"/);
  assert.match(panel, /transition\("draft"\)/);
  assert.match(panel, /transition\("ready"\)/);
  assert.match(panel, /transition\("signed"\)/);
  assert.match(panel, /transition\("issued"\)/);
  assert.match(panel, /Історія версій/);
  assert.match(panel, /Оригінальний виданий протокол не змінено/);
});
