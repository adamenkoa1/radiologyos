import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";

const MIGRATION_URL = new URL("../drizzle/0108_personnel_directory.sql", import.meta.url);
const API_URL = new URL("../app/api/staff/personnel/route.ts", import.meta.url);
const PAGE_URL = new URL("../app/staff/personnel/page.tsx", import.meta.url);
const DIRECTORIES_URL = new URL("../app/staff/directories/page.tsx", import.meta.url);

function makeBaseline() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      slug text NOT NULL,
      name text NOT NULL,
      active integer DEFAULT 1 NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE branches (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      organization_id integer NOT NULL,
      name text NOT NULL,
      active integer DEFAULT 1 NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE departments (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      organization_id integer NOT NULL,
      branch_id integer DEFAULT 0 NOT NULL,
      name text NOT NULL,
      active integer DEFAULT 1 NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE staff_members (
      email text PRIMARY KEY NOT NULL,
      display_name text DEFAULT '' NOT NULL,
      role text DEFAULT 'registrar' NOT NULL,
      active integer DEFAULT 1 NOT NULL,
      phone text DEFAULT '' NOT NULL,
      last_name text DEFAULT '' NOT NULL,
      first_name text DEFAULT '' NOT NULL,
      patronymic text DEFAULT '' NOT NULL,
      contact_email text DEFAULT '' NOT NULL,
      military_rank text DEFAULT '' NOT NULL,
      position_title text DEFAULT '' NOT NULL
    );
    CREATE TABLE memberships (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      organization_id integer NOT NULL,
      member_email text NOT NULL,
      role text NOT NULL,
      active integer DEFAULT 1 NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE UNIQUE INDEX memberships_org_member_idx ON memberships (organization_id, member_email);

    INSERT INTO organizations (id, slug, name) VALUES
      (1, 'org-1', 'Організація 1'),
      (2, 'org-2', 'Організація 2');
    INSERT INTO branches (id, organization_id, name) VALUES
      (1, 1, 'Госпіталь 1'),
      (2, 2, 'Госпіталь 2');
    INSERT INTO departments (id, organization_id, branch_id, name) VALUES
      (1, 1, 1, 'Відділення променевої діагностики'),
      (20, 2, 2, 'Чужий підрозділ');
    INSERT INTO staff_members
      (email, display_name, role, active, phone, last_name, first_name, patronymic, contact_email, military_rank, position_title)
    VALUES
      ('380501112233@phone.local', 'Тестовий Працівник', 'radiographer', 1, '380501112233',
       'Тестовий', 'Працівник', 'Іванович', 'worker@example.test', 'Сержант', 'Рентгенолаборант'),
      ('other@example.test', 'Інший Працівник', 'radiographer', 1, '380509998877',
       'Інший', 'Працівник', '', 'other@example.test', '', 'Рентгенолаборант');
    INSERT INTO memberships (id, organization_id, member_email, role, active) VALUES
      (1, 1, '380501112233@phone.local', 'radiographer', 1),
      (2, 2, 'other@example.test', 'radiographer', 1);
  `);
  return db;
}

test("personnel migration backfills stable HR identity and keeps account optional", async () => {
  const db = makeBaseline();
  try {
    db.exec(await readFile(MIGRATION_URL, "utf8"));

    const migrated = db.prepare(`
      SELECT id, organization_id AS organizationId, account_email AS accountEmail,
             work_phone AS workPhone, work_email AS workEmail, department_id AS departmentId
      FROM personnel_records WHERE organization_id = 1 AND account_email = '380501112233@phone.local'
    `).get();
    assert.deepEqual(Object.fromEntries(Object.entries(migrated)), {
      id: "personnel-1-1",
      organizationId: 1,
      accountEmail: "380501112233@phone.local",
      workPhone: "380501112233",
      workEmail: "worker@example.test",
      departmentId: 1,
    });

    const unitNames = db.prepare(
      "SELECT name FROM departments WHERE organization_id = 1 ORDER BY name",
    ).all().map((row) => row.name);
    assert.ok(unitNames.includes("Пересувний рентгенівський кабінет (ПРК)"));
    assert.ok(unitNames.includes("Кабінет ультразвукової діагностики (УЗД)"));
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS count FROM departments WHERE organization_id = 2 AND name LIKE '%ПРК%'",
    ).get().count, 0);

    db.prepare(`
      INSERT INTO personnel_records
        (id, organization_id, account_email, last_name, first_name, display_name,
         position_title, created_by, updated_by)
      VALUES ('personnel-manual', 1, NULL, 'Без', 'Акаунта', 'Без Акаунта',
              'Водій ПРК', 'admin@example.test', 'admin@example.test')
    `).run();
    assert.equal(db.prepare(
      "SELECT account_email AS accountEmail FROM personnel_records WHERE id = 'personnel-manual'",
    ).get().accountEmail, null);
  } finally {
    db.close();
  }
});

test("personnel migration rejects cross-tenant department and account links", async () => {
  const db = makeBaseline();
  try {
    db.exec(await readFile(MIGRATION_URL, "utf8"));

    assert.throws(() => db.prepare(`
      INSERT INTO personnel_records
        (id, organization_id, last_name, first_name, display_name, position_title,
         department_id, created_by, updated_by)
      VALUES ('bad-department', 1, 'Тест', 'Один', 'Тест Один', 'Лікар-рентгенолог',
              20, 'admin@example.test', 'admin@example.test')
    `).run(), /personnel_department_scope/);

    assert.throws(() => db.prepare(`
      INSERT INTO personnel_records
        (id, organization_id, account_email, last_name, first_name, display_name,
         position_title, created_by, updated_by)
      VALUES ('bad-account', 1, 'other@example.test', 'Тест', 'Два', 'Тест Два',
              'Лікар-рентгенолог', 'admin@example.test', 'admin@example.test')
    `).run(), /personnel_account_scope/);

    const prk = db.prepare(
      "SELECT id FROM departments WHERE organization_id = 1 AND name = 'Пересувний рентгенівський кабінет (ПРК)'",
    ).get();
    assert.doesNotThrow(() => db.prepare(`
      INSERT INTO personnel_records
        (id, organization_id, last_name, first_name, display_name, position_title,
         department_id, created_by, updated_by)
      VALUES ('good-department', 1, 'Тест', 'Три', 'Тест Три', 'Водій ПРК',
              ?, 'admin@example.test', 'admin@example.test')
    `).run(prk.id));
  } finally {
    db.close();
  }
});

test("personnel API is tenant-derived and does not mutate auth identity", async () => {
  const source = await readFile(API_URL, "utf8");
  assert.match(source, /requireSelfServiceOrgContext\(request, db\)/);
  assert.match(source, /role === "admin" \|\| role === "department_head"/);
  assert.match(source, /WHERE p\.organization_id = \?/);
  assert.match(source, /WHERE id = \? AND organization_id = \?/);
  assert.match(source, /accountEmail:[\s\S]*\|\| null/);
  assert.doesNotMatch(source, /UPDATE staff_members/);
  assert.doesNotMatch(source, /INSERT INTO staff_members/);
  assert.doesNotMatch(source, /body\.organizationId/);
});

test("personnel UI is a first-class directory and keeps login separate", async () => {
  const [page, directories] = await Promise.all([
    readFile(PAGE_URL, "utf8"),
    readFile(DIRECTORIES_URL, "utf8"),
  ]);
  assert.match(page, /fetch\("\/api\/staff\/personnel"/);
  assert.match(page, /Картка працівника відокремлена від облікового запису RadiologyOS/);
  assert.match(page, /Робочий телефон/);
  assert.match(page, /Особистий телефон/);
  assert.match(page, /Адреса/);
  assert.match(page, /Підрозділ/);
  assert.match(page, /Без облікового запису/);
  assert.match(directories, /href:"\/staff\/personnel"/);
  assert.match(directories, /Обліковий запис не є кадровою карткою/);
});
