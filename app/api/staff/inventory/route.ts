import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { requireOrgContext } from "../../../../lib/tenant";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = new Set(["contrast","catheter","syringe","infusion","ppe","film","paper","disinfectant","other"]);
const MANAGER_ROLES = new Set(["admin","radiographer"]);

type ItemRow = {
  id:number; sku:string; name:string; category:string; unit:string; minStock:number; active:number;
  stock:number; expiringStock:number; nextExpiry:string;
};
type LotRow = {
  id:number; itemId:number; itemName:string; lotNumber:string; expiresOn:string; supplier:string; stock:number;
};
type MovementRow = {
  id:number; itemId:number; itemName:string; lotId:number; lotNumber:string; movementType:string;
  quantityDelta:number; unit:string; reason:string; bookingId:number|null; actorEmail:string; createdAt:string;
};

function cleanText(value:unknown,max:number) { return String(value || "").trim().slice(0,max); }
function positiveNumber(value:unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function nonNegativeNumber(value:unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function canManage(role:string) { return MANAGER_ROLES.has(role); }

async function itemForOrg(db:D1Database,organizationId:number,itemId:number) {
  return db.prepare("SELECT id, name, unit, active FROM inventory_items WHERE organization_id = ? AND id = ? LIMIT 1")
    .bind(organizationId,itemId).first<{id:number;name:string;unit:string;active:number}>();
}
async function lotForOrg(db:D1Database,organizationId:number,lotId:number) {
  return db.prepare(
    `SELECT l.id, l.item_id AS itemId, i.name, i.unit
     FROM inventory_lots l JOIN inventory_items i ON i.id = l.item_id
     WHERE l.organization_id = ? AND i.organization_id = ? AND l.id = ? LIMIT 1`
  ).bind(organizationId,organizationId,lotId).first<{id:number;itemId:number;name:string;unit:string}>();
}
async function bookingForOrg(db:D1Database,organizationId:number,bookingId:number|null) {
  if (!bookingId) return true;
  return !!(await db.prepare("SELECT 1 AS ok FROM bookings WHERE organization_id = ? AND id = ? LIMIT 1")
    .bind(organizationId,bookingId).first<{ok:number}>());
}

export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });

  const items = await db.prepare(
    `SELECT i.id, i.sku, i.name, i.category, i.unit, i.min_stock AS minStock, i.active,
            COALESCE(SUM(m.quantity_delta),0) AS stock,
            COALESCE(SUM(CASE WHEN l.expires_on <> '' AND l.expires_on <= date('now','+30 day') THEN m.quantity_delta ELSE 0 END),0) AS expiringStock,
            COALESCE(MIN(CASE WHEN l.expires_on >= date('now') THEN l.expires_on END),'') AS nextExpiry
     FROM inventory_items i
     LEFT JOIN inventory_lots l ON l.organization_id = i.organization_id AND l.item_id = i.id
     LEFT JOIN inventory_movements m ON m.organization_id = i.organization_id AND m.item_id = i.id AND m.lot_id = l.id
     WHERE i.organization_id = ?
     GROUP BY i.id
     ORDER BY i.active DESC, i.category, i.name`
  ).bind(ctx.organizationId).all<ItemRow>();

  const lots = await db.prepare(
    `SELECT l.id, l.item_id AS itemId, i.name AS itemName, l.lot_number AS lotNumber,
            l.expires_on AS expiresOn, l.supplier,
            COALESCE(SUM(m.quantity_delta),0) AS stock
     FROM inventory_lots l
     JOIN inventory_items i ON i.id = l.item_id AND i.organization_id = l.organization_id
     LEFT JOIN inventory_movements m ON m.organization_id = l.organization_id AND m.lot_id = l.id
     WHERE l.organization_id = ?
     GROUP BY l.id
     HAVING stock > 0.000001
     ORDER BY CASE WHEN l.expires_on = '' THEN 1 ELSE 0 END, l.expires_on, i.name`
  ).bind(ctx.organizationId).all<LotRow>();

  const movements = await db.prepare(
    `SELECT m.id, m.item_id AS itemId, i.name AS itemName, m.lot_id AS lotId,
            l.lot_number AS lotNumber, m.movement_type AS movementType,
            m.quantity_delta AS quantityDelta, i.unit, m.reason, m.booking_id AS bookingId,
            m.actor_email AS actorEmail, m.created_at AS createdAt
     FROM inventory_movements m
     JOIN inventory_items i ON i.id = m.item_id AND i.organization_id = m.organization_id
     JOIN inventory_lots l ON l.id = m.lot_id AND l.organization_id = m.organization_id
     WHERE m.organization_id = ?
     ORDER BY m.id DESC LIMIT 150`
  ).bind(ctx.organizationId).all<MovementRow>();

  return Response.json({ items:items.results, lots:lots.results, movements:movements.results, staff:ctx.member, canManage:canManage(ctx.role) });
}

export async function POST(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({ error:"Доступ лише для персоналу" }, { status:403 });
  if (!canManage(ctx.role)) return Response.json({ error:"Склад можуть змінювати адміністратор або рентгенолаборант" }, { status:403 });

  const body = await request.json().catch(()=>({})) as Record<string,unknown>;
  const action = cleanText(body.action,30);

  if (action === "create_item") {
    const name = cleanText(body.name,180);
    const sku = cleanText(body.sku,80);
    const category = CATEGORIES.has(String(body.category)) ? String(body.category) : "other";
    const unit = cleanText(body.unit,30) || "шт";
    const minStock = nonNegativeNumber(body.minStock);
    if (!name || minStock === null) return Response.json({ error:"Перевірте назву та мінімальний запас" }, { status:400 });
    try {
      const result = await db.prepare(
        `INSERT INTO inventory_items (organization_id,sku,name,category,unit,min_stock)
         VALUES (?,?,?,?,?,?)`
      ).bind(ctx.organizationId,sku,name,category,unit,minStock).run();
      const id = Number(result.meta.last_row_id || 0);
      await audit(db,{ organizationId:ctx.organizationId, actorEmail:ctx.member.email, action:"inventory_item_created", resource:"inventory", targetId:id, details:{ category, unit, sku:!!sku } });
      return Response.json({ ok:true,id }, { status:201 });
    } catch (e) {
      if (String(e).toLowerCase().includes("unique")) return Response.json({ error:"Такий код номенклатури вже існує" }, { status:409 });
      throw e;
    }
  }

  if (action === "receive") {
    const itemId = Number(body.itemId);
    const quantity = positiveNumber(body.quantity);
    const lotNumber = cleanText(body.lotNumber,100);
    const expiresOn = cleanText(body.expiresOn,10);
    const supplier = cleanText(body.supplier,180);
    const reason = cleanText(body.reason,500) || "Надходження";
    if (!Number.isInteger(itemId) || itemId < 1 || !quantity) return Response.json({ error:"Вкажіть матеріал і кількість" }, { status:400 });
    if (expiresOn && !DATE_RE.test(expiresOn)) return Response.json({ error:"Некоректний термін придатності" }, { status:400 });
    const item = await itemForOrg(db,ctx.organizationId,itemId);
    if (!item || !item.active) return Response.json({ error:"Матеріал не знайдено або він неактивний" }, { status:404 });

    const lotResult = await db.prepare(
      `INSERT INTO inventory_lots (organization_id,item_id,lot_number,expires_on,supplier) VALUES (?,?,?,?,?)`
    ).bind(ctx.organizationId,itemId,lotNumber,expiresOn,supplier).run();
    const lotId = Number(lotResult.meta.last_row_id || 0);
    await db.prepare(
      `INSERT INTO inventory_movements (organization_id,item_id,lot_id,movement_type,quantity_delta,reason,actor_email)
       VALUES (?,?,?,'receipt',?,?,?)`
    ).bind(ctx.organizationId,itemId,lotId,quantity,reason,ctx.member.email).run();
    await audit(db,{ organizationId:ctx.organizationId, actorEmail:ctx.member.email, action:"inventory_received", resource:"inventory", targetId:itemId, details:{ lotId, quantity, hasExpiry:!!expiresOn } });
    return Response.json({ ok:true,lotId }, { status:201 });
  }

  if (action === "writeoff") {
    const lotId = Number(body.lotId);
    const quantity = positiveNumber(body.quantity);
    const reason = cleanText(body.reason,500);
    const rawBookingId = Number(body.bookingId);
    const bookingId = Number.isInteger(rawBookingId) && rawBookingId > 0 ? rawBookingId : null;
    if (!Number.isInteger(lotId) || lotId < 1 || !quantity || !reason) return Response.json({ error:"Вкажіть партію, кількість і причину списання" }, { status:400 });
    const lot = await lotForOrg(db,ctx.organizationId,lotId);
    if (!lot) return Response.json({ error:"Партію не знайдено" }, { status:404 });
    if (!(await bookingForOrg(db,ctx.organizationId,bookingId))) return Response.json({ error:"Дослідження не належить до цієї організації" }, { status:400 });
    try {
      await db.prepare(
        `INSERT INTO inventory_movements (organization_id,item_id,lot_id,movement_type,quantity_delta,reason,booking_id,actor_email)
         VALUES (?,?,?,'writeoff',-?,?,?,?)`
      ).bind(ctx.organizationId,lot.itemId,lotId,quantity,reason,bookingId,ctx.member.email).run();
    } catch (e) {
      if (String(e).includes("insufficient_stock")) return Response.json({ error:"Недостатній залишок у цій партії" }, { status:409 });
      throw e;
    }
    await audit(db,{ organizationId:ctx.organizationId, actorEmail:ctx.member.email, action:"inventory_written_off", resource:"inventory", targetId:lot.itemId, details:{ lotId, quantity, linkedBooking:!!bookingId } });
    return Response.json({ ok:true });
  }

  return Response.json({ error:"Невідома операція складу" }, { status:400 });
}

export async function PATCH(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error:"База тимчасово недоступна" }, { status:503 });
  const ctx = await requireOrgContext(request,db);
  if (!ctx || ctx.role !== "admin") return Response.json({ error:"Змінювати номенклатуру може лише адміністратор" }, { status:403 });
  const body = await request.json().catch(()=>({})) as Record<string,unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error:"Некоректний матеріал" }, { status:400 });
  const existing = await itemForOrg(db,ctx.organizationId,id);
  if (!existing) return Response.json({ error:"Матеріал не знайдено" }, { status:404 });
  const name = body.name === undefined ? existing.name : cleanText(body.name,180);
  const unit = body.unit === undefined ? existing.unit : cleanText(body.unit,30);
  const minStock = body.minStock === undefined ? null : nonNegativeNumber(body.minStock);
  const active = body.active === undefined ? existing.active : body.active ? 1 : 0;
  if (!name || !unit || (body.minStock !== undefined && minStock === null)) return Response.json({ error:"Некоректні параметри матеріалу" }, { status:400 });
  await db.prepare(
    `UPDATE inventory_items SET name=?, unit=?, min_stock=COALESCE(?,min_stock), active=?, updated_at=CURRENT_TIMESTAMP
     WHERE organization_id=? AND id=?`
  ).bind(name,unit,minStock,active,ctx.organizationId,id).run();
  await audit(db,{ organizationId:ctx.organizationId, actorEmail:ctx.member.email, action:"inventory_item_updated", resource:"inventory", targetId:id, details:{ active:!!active } });
  return Response.json({ ok:true });
}
