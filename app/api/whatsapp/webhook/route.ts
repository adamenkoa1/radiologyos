// Public Green API webhook. The webhook secret resolves exactly one organization;
// every lookup, communication insert and bot reply stays inside that tenant.

import { resolveOrganizationByIntegrationSecret } from "../../../../lib/settings";
import { isRateLimited } from "../../../../lib/rate-limit";
import { getOrgProfile } from "../../../../lib/org-profile";
import { interpretBotCommand, menuText, parseIncomingWebhook, sendWhatsApp } from "../../../../lib/whatsapp";
import { dbBinding } from "../../../../lib/db";

function todayKyiv(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Kyiv", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
}

async function botReply(
  db:D1Database,
  organizationId:number,
  phone:string,
  text:string,
  origin:string,
):Promise<string|null> {
  const action=interpretBotCommand(text);
  if(action==="menu") return menuText();
  if(action==="human") return "Передав ваше звернення адміністратору — незабаром звʼяжемося.";
  if(action==="booking") return `Записатися можна тут: ${origin}\nОберіть послугу й натисніть «Записатися».`;
  if(action==="info") {
    const profile=await getOrgProfile(db,{organizationId} as never).catch(()=>null);
    const name=profile?.name || "Медичний заклад";
    return `${name}\nІнформація та запис: ${origin}`;
  }
  if(action==="appointments") {
    const rows=await db.prepare(
      `SELECT service, desired_date AS d, desired_time AS t, status FROM bookings
       WHERE organization_id = ? AND phone_normalized = ? AND desired_date >= ? AND status NOT IN ('cancelled','completed')
       ORDER BY desired_date, desired_time LIMIT 5`
    ).bind(organizationId,phone,todayKyiv()).all();
    const list=(rows.results||[]) as Array<{service:string;d:string;t:string}>;
    if(!list.length) return "У вас немає найближчих записів. Надішліть 2, щоб записатися.";
    return ["Ваші найближчі записи:",...list.map((r)=>`• ${r.d}${r.t?` ${r.t}`:""} — ${r.service}`)].join("\n");
  }
  return null;
}

export async function POST(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({ok:false},{status:503});

  const url=new URL(request.url);
  const token=request.headers.get("x-webhook-token") || url.searchParams.get("token") || "";
  const organizationId=await resolveOrganizationByIntegrationSecret(db,"whatsapp_webhook_token",token);
  if(!organizationId) return Response.json({ok:false},{status:401});
  if(await isRateLimited(db,request,`whatsapp-webhook:${organizationId}`,60,15)) return Response.json({ok:true});

  const body=await request.json().catch(()=>null);
  const msg=parseIncomingWebhook(body);
  if(!msg) return Response.json({ok:true});

  const inserted=await db.prepare(
    `INSERT OR IGNORE INTO patient_communications
      (organization_id, phone_normalized, channel, direction, summary, actor, external_id)
     VALUES (?, ?, 'whatsapp', 'inbound', ?, 'patient', ?)`
  ).bind(
    organizationId,
    msg.phoneNormalized,
    msg.text||"(без тексту)",
    msg.idMessage||`${msg.phoneNormalized}-${msg.text.slice(0,40)}`,
  ).run();
  if(!inserted.meta.changes) return Response.json({ok:true});

  const reply=await botReply(db,organizationId,msg.phoneNormalized,msg.text,url.origin);
  if(reply) {
    const sent=await sendWhatsApp(db,msg.phoneNormalized,reply,organizationId);
    if(sent.ok) {
      await db.prepare(
        `INSERT INTO patient_communications
          (organization_id, phone_normalized, channel, direction, summary, actor, external_id)
         VALUES (?, ?, 'whatsapp', 'outbound', ?, 'bot', ?)`
      ).bind(organizationId,msg.phoneNormalized,reply,sent.idMessage||"").run();
    }
  }
  return Response.json({ok:true});
}
