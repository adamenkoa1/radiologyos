// Best-effort Telegram notifications. Bot credentials are organization-scoped.
// Optional organization ids preserve the legacy public org1 path; tenant-aware
// routes must pass their server-derived organization id explicitly.

import {
  getOrganizationIntegrationSettings,
  setOrganizationIntegrationSetting,
} from "./settings";

const LEGACY_PUBLIC_ORGANIZATION_ID = 1;

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (m) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[m] as string));
}

export interface BookingNotice { codes:string[]; desiredDate:string; desiredTime:string }

export function bookingMessage(notice: BookingNotice): string {
  const when = notice.desiredDate
    ? `${notice.desiredDate}${notice.desiredTime ? ` о ${notice.desiredTime}` : ""}`
    : "реєстратура погоджує з пацієнтом";
  return [
    "🆕 <b>Нова заявка</b>",
    `📅 Бажаний час: ${escapeHtml(when)}`,
    `🔖 Код: ${notice.codes.map(escapeHtml).join(", ")}`,
    "Відкрийте захищений кабінет персоналу для перегляду деталей.",
  ].join("\n");
}

export async function sendTelegramResult(
  db:D1Database,
  text:string,
  organizationId=LEGACY_PUBLIC_ORGANIZATION_ID,
):Promise<{ok:boolean;error?:string}> {
  const { telegram_bot_token:token, telegram_chat_id:chatId } =
    await getOrganizationIntegrationSettings(db, organizationId, ["telegram_bot_token", "telegram_chat_id"]);
  if (!token || !chatId) return { ok:false, error:"Спочатку збережіть токен бота та ID чату" };
  try {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),3000);
    const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({chat_id:chatId,text,parse_mode:"HTML",disable_web_page_preview:true}), signal:controller.signal,
    });
    clearTimeout(timer);
    if(response.ok) return {ok:true};
    const data=await response.json().catch(()=>({})) as {description?:string};
    return {ok:false,error:data.description||`Telegram відповів помилкою (${response.status})`};
  } catch { return {ok:false,error:"Не вдалося з'єднатися з Telegram"}; }
}

export async function sendTelegram(db:D1Database,text:string,organizationId=LEGACY_PUBLIC_ORGANIZATION_ID):Promise<boolean>{
  return (await sendTelegramResult(db,text,organizationId)).ok;
}

export async function sendTelegramTo(
  db:D1Database, chatId:string, text:string, organizationId=LEGACY_PUBLIC_ORGANIZATION_ID,
):Promise<{ok:boolean;error?:string}> {
  const {telegram_bot_token:token}=await getOrganizationIntegrationSettings(db,organizationId,["telegram_bot_token"]);
  if(!token) return {ok:false,error:"Бот Telegram не налаштований"};
  if(!chatId) return {ok:false,error:"Немає chat_id пацієнта"};
  try {
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),3000);
    const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({chat_id:chatId,text,parse_mode:"HTML",disable_web_page_preview:true}),signal:controller.signal,
    });
    clearTimeout(timer);
    if(response.ok) return {ok:true};
    const data=await response.json().catch(()=>({})) as {description?:string};
    return {ok:false,error:data.description||`Telegram відповів помилкою (${response.status})`};
  } catch { return {ok:false,error:"Не вдалося з'єднатися з Telegram"}; }
}

export async function telegramBotUsername(
  db:D1Database,
  organizationId=LEGACY_PUBLIC_ORGANIZATION_ID,
):Promise<string> {
  const {telegram_bot_token:token,telegram_bot_username:cached}=await getOrganizationIntegrationSettings(
    db,organizationId,["telegram_bot_token","telegram_bot_username"]
  );
  if(!token) return "";
  if(cached) return cached;
  try {
    const response=await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data=await response.json().catch(()=>({})) as {ok?:boolean;result?:{username?:string}};
    const username=data.ok&&data.result?.username?data.result.username:"";
    if(username) await setOrganizationIntegrationSetting(db,organizationId,"telegram_bot_username",username,"telegram:getMe");
    return username;
  } catch { return ""; }
}

export async function setTelegramWebhook(
  db:D1Database, url:string, secret:string, organizationId=LEGACY_PUBLIC_ORGANIZATION_ID,
):Promise<{ok:boolean;error?:string}> {
  const {telegram_bot_token:token}=await getOrganizationIntegrationSettings(db,organizationId,["telegram_bot_token"]);
  if(!token) return {ok:false,error:"Спочатку збережіть токен бота"};
  try {
    const response=await fetch(`https://api.telegram.org/bot${token}/setWebhook`,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({url,secret_token:secret,allowed_updates:["message"]}),
    });
    const data=await response.json().catch(()=>({})) as {ok?:boolean;description?:string};
    if(data.ok) return {ok:true};
    return {ok:false,error:data.description||`Telegram відповів помилкою (${response.status})`};
  } catch { return {ok:false,error:"Не вдалося з'єднатися з Telegram"}; }
}
