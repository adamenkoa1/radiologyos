import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  STUDY_STATES,
  STUDY_STATE_LABELS,
  TRANSITIONS,
  canTransition,
  isStudyState,
  isTerminal,
  nextStates,
  stateLabel,
} from "../lib/study-state.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// 15 канонічних станів у клінічному порядку.
test("machine defines the 15 canonical states with labels", () => {
  assert.equal(STUDY_STATES.length, 15);
  const expected = [
    "requested", "needs_verification", "scheduled", "confirmed", "arrived",
    "queued", "in_progress", "performed", "images_ready", "reporting",
    "protocol_ready", "issued", "completed", "cancelled", "no_show",
  ];
  assert.deepEqual([...STUDY_STATES], expected);
  for (const s of STUDY_STATES) {
    assert.ok(STUDY_STATE_LABELS[s], `label for ${s}`);
    assert.ok(isStudyState(s));
  }
  // Legacy-стани діючого UI визнаються, але не входять до канонічного переліку.
  assert.ok(isStudyState("new") && isStudyState("rescheduled"));
  assert.ok(!STUDY_STATES.includes("new"));
});

// Повний клінічний шлях проходиться крок за кроком.
test("the full clinical path is walkable end-to-end", () => {
  const path = [
    "requested", "needs_verification", "scheduled", "confirmed", "arrived",
    "queued", "in_progress", "performed", "images_ready", "reporting",
    "protocol_ready", "issued", "completed",
  ];
  for (let i = 0; i < path.length - 1; i += 1) {
    assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]} allowed`);
  }
});

// Deny-by-default: перескоки й виходи з термінальних станів заборонені.
test("illegal jumps are rejected (deny-by-default)", () => {
  assert.equal(canTransition("requested", "in_progress"), false);
  assert.equal(canTransition("scheduled", "performed"), false);
  assert.equal(canTransition("completed", "in_progress"), false);
  assert.equal(canTransition("queued", "issued"), false);
  assert.equal(canTransition("anything", "made_up"), false);
  assert.equal(canTransition("in_progress", "unknown_state"), false);
  // Той самий стан (no-op) дозволено, щоб повторне збереження не падало.
  assert.equal(canTransition("confirmed", "confirmed"), true);
});

// Кожен клінічний шлях може завершитися скасуванням до видачі.
test("cancellation is reachable from active states, terminals are terminal", () => {
  for (const s of ["scheduled", "arrived", "queued", "in_progress", "performed"]) {
    assert.ok(canTransition(s, "cancelled"), `${s} → cancelled`);
  }
  assert.ok(isTerminal("completed"));
  assert.ok(isTerminal("cancelled"));
  assert.ok(!isTerminal("in_progress"));
});

// Сумісність: діючий UI виставляє 5 legacy-станів; переходи між ними вільні.
test("legacy UI statuses remain fully interchangeable (no regression)", () => {
  const legacy = ["new", "confirmed", "rescheduled", "completed", "cancelled"];
  for (const from of legacy) {
    for (const to of legacy) {
      assert.ok(canTransition(from, to), `legacy ${from} → ${to} preserved`);
    }
  }
  assert.equal(stateLabel("new"), "Нова");
  assert.equal(nextStates("issued").includes("completed"), true);
});

// Жоден стан не має «мертвих» переходів у невідомі стани.
test("every transition target is a known state", () => {
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    for (const to of targets) {
      assert.ok(isStudyState(to), `${from} → ${to} target is known`);
    }
  }
});

// Сервер застосовує машину замість плаского списку статусів.
test("staff bookings route enforces the machine, not a flat allow-list", async () => {
  const src = await read("app/api/staff/bookings/route.ts");
  assert.match(src, /canTransition\(current\.status, body\.status\)/);
  assert.match(src, /isStudyState\(body\.status\)/);
  // Старий плаский Set статусів прибрано.
  assert.doesNotMatch(src, /new Set\(\["new", "confirmed", "rescheduled", "completed", "cancelled"\]\)/);
});
