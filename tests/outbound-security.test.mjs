import assert from "node:assert/strict";
import test from "node:test";
import { safeOutboundUrl } from "../lib/outbound.ts";

const runtime = globalThis;

function setAllowlist(value) {
  runtime.__RADIOLOGY_OUTBOUND_ALLOWED_HOSTS__ = value;
}

test.afterEach(() => {
  delete runtime.__RADIOLOGY_OUTBOUND_ALLOWED_HOSTS__;
});

test("outbound URLs fail closed when allowlist is absent or empty", () => {
  assert.equal(safeOutboundUrl("https://pacs.example.test/dicom-web"), null);
  setAllowlist("");
  assert.equal(safeOutboundUrl("https://calendar.example.test/feed.ics"), null);
});

test("outbound policy permits only exact explicitly allowed HTTPS hosts", () => {
  setAllowlist("PACS.EXAMPLE.TEST, calendar.example.test");

  assert.equal(safeOutboundUrl("https://pacs.example.test/dicom-web")?.hostname, "pacs.example.test");
  assert.equal(safeOutboundUrl("https://calendar.example.test/feed.ics")?.hostname, "calendar.example.test");
  assert.equal(safeOutboundUrl("https://other.example.test/feed.ics"), null);
  assert.equal(safeOutboundUrl("https://sub.pacs.example.test/dicom-web"), null);
  assert.equal(safeOutboundUrl("http://pacs.example.test/dicom-web"), null);
  assert.equal(safeOutboundUrl("https://user:pass@pacs.example.test/dicom-web"), null);
});

test("private hosts stay blocked unless deliberately allowlisted", () => {
  setAllowlist("pacs.example.test");
  assert.equal(safeOutboundUrl("https://127.0.0.1/dicom-web"), null);
  assert.equal(safeOutboundUrl("https://10.0.0.5/dicom-web"), null);
  assert.equal(safeOutboundUrl("https://service.internal/feed.ics"), null);

  setAllowlist("10.0.0.5");
  assert.equal(safeOutboundUrl("https://10.0.0.5/dicom-web")?.hostname, "10.0.0.5");
});
