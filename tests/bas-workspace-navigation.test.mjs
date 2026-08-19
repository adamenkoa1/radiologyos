import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell=readFileSync("app/staff/workspace-shell.tsx","utf8");
const documents=readFileSync("app/staff/documents/page.tsx","utf8");
const registers=readFileSync("app/staff/registers/page.tsx","utf8");
const directories=readFileSync("app/staff/directories/page.tsx","utf8");
const globals=readFileSync("app/globals.css","utf8");
const density=readFileSync("app/styles/23-bas-enterprise-density.css","utf8");

test("staff workspace exposes BAS documents and registers as first-class navigation",()=>{
  assert.match(shell,/BAS-контур/);
  assert.match(shell,/label:"Документи",href:"\/staff\/documents",section:"documents"/);
  assert.match(shell,/label:"Регістри",href:"\/staff\/registers",section:"registers"/);
  assert.match(shell,/key:"documents",label:"Документи"/);
  assert.match(shell,/key:"registers",label:"Регістри"/);
  assert.match(shell,/key:"directories",label:"Довідники"/);
  assert.match(shell,/\/staff\/documents\?type=patient_order/);
  assert.match(shell,/Документи · регістри · медицина/);
});

test("document journal supports canonical BAS filtering and lineage",()=>{
  assert.match(documents,/active="documents"/);
  assert.match(documents,/params\.get\("type"\)/);
  assert.match(documents,/params\.get\("state"\)/);
  assert.match(documents,/row\.journalType!==typeFilter/);
  assert.match(documents,/row\.state!==stateFilter/);
  assert.match(documents,/Єдиний журнал реєстраторів/);
  assert.match(documents,/Ланцюжок документа/);
  assert.match(documents,/← Підстава/);
  assert.match(documents,/→ Похідний/);
  assert.match(documents,/Рухів регістрів/);
});

test("register and directory landing pages are read-model maps, not duplicate stores",()=>{
  assert.match(registers,/active="registers"/);
  assert.match(registers,/Підстава → Документ → Проведення → Регістр → Звіт/);
  assert.match(registers,/не створює паралельних таблиць/);
  assert.match(registers,/immutable історія/);
  assert.match(directories,/active="directories"/);
  assert.match(directories,/Єдині master-data RadiologyOS/);
  assert.match(directories,/без копій у формах/);
});

test("BAS density layer is global, last in cascade, and keeps compact enterprise geometry",()=>{
  assert.match(globals,/22-shift-calendar\.css";\n@import "\.\/styles\/23-bas-enterprise-density\.css";/);
  assert.match(density,/--workspace-sidebar:224px/);
  assert.match(density,/--bas-topbar:48px/);
  assert.match(density,/--bas-modules:34px/);
  assert.match(density,/--bas-commands:38px/);
  assert.match(density,/--bas-control:30px/);
  assert.match(density,/--bas-row:32px/);
  assert.match(density,/\.basWorkspaceShell table thead th/);
  assert.match(density,/\.basWorkspaceShell table tbody td/);
  assert.match(density,/\.basWorkspaceShell \.financeJournal/);
  assert.match(density,/@media\(max-width:560px\)/);
});
