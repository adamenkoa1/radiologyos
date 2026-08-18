import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUDIT_LABELS,toAuditCsv } from "../lib/audit.ts";

const read=(p)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");

const CLINICAL_READ_LABELS={
  contact_center_thread_viewed:"Переглянуто діалог контакт-центру",
  protocol_addenda_viewed:"Переглянуто виправлення до протоколу",
  protocol_revision_viewed:"Переглянуто версію протоколу",
};

test("every explicit clinical read action emitted by its route has a human audit label",async()=>{
  const [chat,addenda,revisions]=await Promise.all([
    read("app/api/staff/chat/route.ts"),
    read("app/api/staff/protocols/addenda/route.ts"),
    read("app/api/staff/protocols/revisions/route.ts"),
  ]);
  const routes={contact_center_thread_viewed:chat,protocol_addenda_viewed:addenda,protocol_revision_viewed:revisions};
  for(const [action,label] of Object.entries(CLINICAL_READ_LABELS)){
    assert.match(routes[action],new RegExp(action));
    assert.equal(AUDIT_LABELS[action],label,`missing human label for ${action}`);
  }
});

test("audit UI filter is label-driven and CSV renders clinical read labels",async()=>{
  const [page,route]=await Promise.all([
    read("app/staff/audit/page.tsx"),
    read("app/api/staff/audit/route.ts"),
  ]);
  assert.match(page,/Object\.entries\(labels\)/);
  assert.match(route,/labels:\s*AUDIT_LABELS/);

  const csv=toAuditCsv([{
    id:1,
    actorEmail:"reader@example.com",
    action:"protocol_revision_viewed",
    resource:"protocol_revision",
    targetId:"42:3",
    detailsJson:'{"version":3}',
    createdAt:"2026-08-18 12:00:00",
  }]);
  assert.match(csv,/protocol_revision_viewed/);
  assert.match(csv,/Переглянуто версію протоколу/);
});
