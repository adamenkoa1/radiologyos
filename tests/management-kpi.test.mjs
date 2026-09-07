// «Червоні зони» — чиста логіка порогів і сортування карток.

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateThreshold, buildRedZones, attentionCount } from "../lib/management-kpi.ts";

test("evaluateThreshold: більше = гірше", () => {
  assert.equal(evaluateThreshold(0, 1, 5), "ok");
  assert.equal(evaluateThreshold(1, 1, 5), "warn");
  assert.equal(evaluateThreshold(4, 1, 5), "warn");
  assert.equal(evaluateThreshold(5, 1, 5), "alert");
  assert.equal(evaluateThreshold(99, 1, 5), "alert");
});

test("buildRedZones повертає 6 карток, сортує alert→warn→ok, рахує зони уваги", () => {
  const cards = buildRedZones({
    overdueProtocols: 6,   // alert (≥5)
    readyToIssue: 0,       // ok
    needImaging: 2,        // warn (≥1)
    newBookings: 0,        // ok
    openFaults: 0,         // ok
    activeDowntime: 0,
    receivablesDue: 0,     // ok
  });
  assert.equal(cards.length, 6);
  assert.equal(cards[0].key, "overdueProtocols");
  assert.equal(cards[0].status, "alert");
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c.status]));
  assert.equal(byKey.needImaging, "warn");
  assert.equal(byKey.readyToIssue, "ok");
  assert.equal(attentionCount(cards), 2); // 1 alert + 1 warn
});

test("openFaults будь-яке >0 = alert; downtime у підказці", () => {
  const cards = buildRedZones({
    overdueProtocols: 0, readyToIssue: 0, needImaging: 0, newBookings: 0,
    openFaults: 1, activeDowntime: 2, receivablesDue: 0,
  });
  const faults = cards.find((c) => c.key === "openFaults");
  assert.equal(faults.status, "alert");
  assert.match(faults.hint, /Активний простій: 2/);
});

test("receivablesDue у гривнях з порогами 50k/200k", () => {
  const mk = (v) => buildRedZones({ overdueProtocols: 0, readyToIssue: 0, needImaging: 0, newBookings: 0, openFaults: 0, activeDowntime: 0, receivablesDue: v })
    .find((c) => c.key === "receivablesDue");
  assert.equal(mk(0).status, "ok");
  assert.equal(mk(60000).status, "warn");
  assert.equal(mk(250000).status, "alert");
  assert.equal(mk(60000).unit, "грн");
});
