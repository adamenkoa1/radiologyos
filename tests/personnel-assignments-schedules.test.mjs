import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";

const MIGRATION_URL = new URL("../drizzle/0115_personnel_assignments_schedules.sql", import.meta.url);
const PERSONNEL_API_URL = new URL("../app/api/staff/personnel/route.ts", import.meta.url);
const SHIFTS_API_URL = new URL("../app/api/staff/shifts/route.ts", import.meta.url);
const PERSONNEL_PAGE_URL = new URL("../app/staff/personnel/page.tsx", import.meta.url);
const SHIFTS_PAGE_URL = new URL("../app/staff/shifts/page.tsx", import.meta.url);

function baseline() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE departments (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      organization_id integer NOT NULL,
      branch_id integer DEFAULT 0 NOT NULL,
      name text NOT NULL,
      active integer DEFAULT 1 NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE personnel_records (
      id text PRIMARY KEY NOT NULL,
      organization_id integer NOT NULL,
      account_email text,
      position_title text DEFAULT '' NOT NULL,
      department_id integer,
      display_name text DEFAULT '' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE staff_shift_assignments (
      organization_id integer NOT NULL,
      staff_email text NOT NULL,
      preset_code text NOT NULL,
      team_index integer NOT NULL,
      anchor_date text NOT NULL,
      created_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_by text NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY (organization_id, staff_email)
    );
    CREATE TABLE staff_shift_overrides (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      organization_id integer NOT NULL,
      staff_email text NOT NULL,
      shift_date text NOT NULL,
      kind text NOT NULL,
      label text DEFAULT '' NOT NULL,
      start_time text DEFAULT '' NOT NULL,
      end_time text DEFAULT '' NOT NULL,
      note text DEFAULT '' NOT NULL,
      created_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_by text NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    INSERT INTO departments (id, organization_id, name) VALUES
      (1, 1, 'Відділення променевої діагностики'),
      (2, 1, 'Пересувний рентгенівський кабінет (ПРК)'),
      (3, 1, 'Кабінет ультразвукової діагностики (УЗД)'),
      (20, 2, 'Чужий підрозділ');
    INSERT INTO personnel_records
      (id, organization_id, account_email, position_title, department_id, display_name)
    VALUES
      ('person-1', 1, 'one@example.test', 'Начальник відділення', 1, 'Працівник Один'),
      ('person-accountless', 1, NULL, 'Рентгенолаборант ПРК', 2, 'Працівник Без Акаунта'),
      ('person-other-org', 2, 'other@example.test', 'Лікар', 20, 'Працівник Іншої Організації');
    INSERT INTO staff_shift_assignments
      (organization_id, staff_email, preset_code, team_index, anchor_date, created_by, updated_by)
    VALUES (1, 'one@example.test', 'calendar6-4', 1, '2026-08-01', 'admin', 'admin');
    INSERT INTO staff_shift_overrides
      (organization_id, staff_email, shift_date, kind, label, start_time, end_time, note, created_by, updated_by)
    VALUES (1, 'one@example.test', '2026-08-03', 'leave', 'Вп', '', '', '', 'admin', 'admin');
  `);
  return db;
}

test("personnel assignment migration preserves one person with multiple service assignments", async () => {
  const db = baseline();
  try {
    db.exec(await readFile(MIGRATION_URL, "utf8"));
    const base = db.prepare(
      "SELECT personnel_id AS personnelId, position_title AS positionTitle FROM personnel_assignments WHERE personnel_id = 'person-1'"
    ).all();
    assert.equal(base.length, 1);
    assert.equal(base[0].positionTitle, "Начальник відділення");

    assert.doesNotThrow(() => db.prepare(`
      INSERT INTO personnel_assignments
        (id, organization_id, personnel_id, department_id, position_title, assignment_kind,
         starts_on, created_by, updated_by)
      VALUES ('acting-1', 1, 'person-1', 2, 'ТВО начальника ПРК', 'acting',
              '2026-08-01', 'admin', 'admin')
    `).run());
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS count FROM personnel_assignments WHERE personnel_id = 'person-1'"
    ).get().count, 2);
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS count FROM personnel_records WHERE id = 'person-1'"
    ).get().count, 1);

    assert.throws(() => db.prepare(`
      INSERT INTO personnel_assignments
        (id, organization_id, personnel_id, department_id, position_title, assignment_kind,
         starts_on, created_by, updated_by)
      VALUES ('primary-duplicate', 1, 'person-1', 2, 'Ще одна основна', 'primary',
              '2026-08-01', 'admin', 'admin')
    `).run(), /UNIQUE constraint failed/);
  } finally { db.close(); }
});

test("department hierarchy and personnel scoped roster work without an account", async () => {
  const db = baseline();
  try {
    db.exec(await readFile(MIGRATION_URL, "utf8"));
    const prk = db.prepare(`
      SELECT parent_department_id AS parentId, unit_type AS unitType
      FROM department_structure WHERE organization_id = 1 AND department_id = 2
    `).get();
    assert.equal(prk.parentId, 1);
    assert.equal(prk.unitType, "subdivision");

    assert.doesNotThrow(() => db.prepare(`
      INSERT INTO personnel_shift_assignments
        (organization_id, personnel_id, preset_code, team_index, anchor_date, created_by, updated_by)
      VALUES (1, 'person-accountless', 'calendar6-3', 1, '2026-08-01', 'admin', 'admin')
    `).run());
    assert.equal(db.prepare(
      "SELECT preset_code AS presetCode FROM personnel_shift_assignments WHERE personnel_id = 'person-accountless'"
    ).get().presetCode, "calendar6-3");

    const migrated = db.prepare(
      "SELECT personnel_id AS personnelId FROM personnel_shift_assignments WHERE personnel_id = 'person-1'"
    ).get();
    assert.equal(migrated.personnelId, "person-1");
    assert.equal(db.prepare(
      "SELECT kind FROM personnel_shift_overrides WHERE personnel_id = 'person-1' AND shift_date = '2026-08-03'"
    ).get().kind, "leave");

    assert.throws(() => db.prepare(`
      INSERT INTO personnel_shift_assignments
        (organization_id, personnel_id, preset_code, team_index, anchor_date, created_by, updated_by)
      VALUES (1, 'person-other-org', 'calendar6-1', 1, '2026-08-01', 'admin', 'admin')
    `).run(), /personnel_shift_assignment_scope/);
  } finally { db.close(); }
});

test("work schedules keep seven-day normative templates separate from operational shifts", async () => {
  const db = baseline();
  try {
    db.exec(await readFile(MIGRATION_URL, "utf8"));
    db.prepare(`
      INSERT INTO personnel_work_schedules
        (id, organization_id, personnel_id, name, schedule_kind, valid_from,
         weekly_minutes, created_by, updated_by)
      VALUES ('schedule-1', 1, 'person-1', 'Основний режим', 'five_day', '2026-08-01',
              2400, 'admin', 'admin')
    `).run();
    const insertDay = db.prepare(`
      INSERT INTO personnel_work_schedule_days
        (schedule_id, organization_id, weekday, is_working, start_time, end_time, break_start, break_end)
      VALUES ('schedule-1', 1, ?, ?, ?, ?, ?, ?)
    `);
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const working = weekday <= 5;
      insertDay.run(weekday, working ? 1 : 0, working ? '08:30' : '', working ? '17:30' : '', working ? '12:30' : '', working ? '13:30' : '');
    }
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS count FROM personnel_work_schedule_days WHERE schedule_id = 'schedule-1'"
    ).get().count, 7);
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS count FROM personnel_shift_assignments WHERE personnel_id = 'person-1'"
    ).get().count, 1, "operational roster remains a separate register");

    assert.throws(() => db.prepare(`
      INSERT INTO personnel_work_schedules
        (id, organization_id, personnel_id, name, schedule_kind, valid_from,
         weekly_minutes, created_by, updated_by)
      VALUES ('bad-schedule', 1, 'person-other-org', 'Bad', 'individual', '2026-08-01',
              0, 'admin', 'admin')
    `).run(), /personnel_work_schedule_scope/);
  } finally { db.close(); }
});

test("personnel and shift source contracts use stable personnelId and expose the integrated HR card", async () => {
  const [personnelApi, shiftsApi, personnelPage, shiftsPage] = await Promise.all([
    readFile(PERSONNEL_API_URL, "utf8"), readFile(SHIFTS_API_URL, "utf8"),
    readFile(PERSONNEL_PAGE_URL, "utf8"), readFile(SHIFTS_PAGE_URL, "utf8"),
  ]);
  assert.match(personnelApi, /personnel_assignments/);
  assert.match(personnelApi, /personnel_work_schedules/);
  assert.match(personnelApi, /weeklyMinutes/);
  assert.match(personnelApi, /vlkDecisionCode/);
  assert.match(shiftsApi, /personnel_shift_assignments/);
  assert.match(shiftsApi, /body\.personnelId/);
  assert.match(shiftsApi, /p\.account_email = \?/);
  assert.match(personnelPage, /Призначення і посадові обов’язки/);
  assert.match(personnelPage, /Графік роботи/);
  assert.match(personnelPage, /Працівник не дублюється/);
  assert.match(shiftsPage, /без акаунта/);
  assert.match(shiftsPage, /personnelId/);
});