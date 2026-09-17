import { addMinutes } from "./catalog";
import { isBookableDate } from "./booking-rules";
import { candidateTimesFor, hoursFor, isEquipmentDayOpen } from "./schedule";
import { getOrganizationSchedule } from "./tenant-schedule";
import { sendPatientReminder, type ReminderBooking } from "./notify";
import { getOrganizationIntegrationSettings } from "./settings";

interface TelegramBookingCallback {
  id?: string;
  data?: string;
  from?: { id?: number|string };
  message?: { chat?: { id?: number|string } };
}

export interface TelegramBookingActionResult {
  handled:boolean;
  callbackId:string;
  chatId:string;
  ok:boolean;
  message:string;
}

export async function handleTelegramBookingAction(
  db:D1Database,
  callback:TelegramBookingCallback,
  organizationId:number,
):Promise<TelegramBookingActionResult> {
  const callbackId=String(callback?.id||"");
  const chatId=callback?.message?.chat?.id!=null?String(callback.message.chat.id):"";
  const data=String(callback?.data||"");
  const match=data.match(/^booking:confirm:(RD-[A-Z0-9-]{6,40})$/i);
  if(!match) return {handled:false,callbackId,chatId,ok:false,message:"Невідома дія"};

  const {telegram_chat_id:registrarChatId}=await getOrganizationIntegrationSettings(
    db,organizationId,["telegram_chat_id"],
  );
  if(!chatId||chatId!==registrarChatId) {
    return {handled:true,callbackId,chatId,ok:false,message:"Ця дія доступна лише в чаті реєстратури"};
  }

  const code=match[1].toUpperCase();
  const booking=await db.prepare(
    `SELECT id, code, status, service_code AS serviceCode, equipment_id AS equipmentId,
      duration_minutes AS durationMinutes, desired_date AS desiredDate, desired_time AS desiredTime,
      name, phone, phone_normalized AS phoneNormalized, patient_email AS patientEmail, service
     FROM bookings WHERE organization_id = ? AND code = ? LIMIT 1`,
  ).bind(organizationId,code).first<{
    id:number;code:string;status:string;serviceCode:string;equipmentId:string;durationMinutes:number;
    desiredDate:string;desiredTime:string;name:string;phone:string;phoneNormalized:string;patientEmail:string;service:string;
  }>();
  if(!booking) return {handled:true,callbackId,chatId,ok:false,message:"Заявку не знайдено"};
  if(booking.status==="confirmed") {
    return {handled:true,callbackId,chatId,ok:true,message:`Запис ${code} уже підтверджено`};
  }
  if(!["new","scheduled","rescheduled"].includes(booking.status)) {
    return {handled:true,callbackId,chatId,ok:false,message:`Запис ${code} уже має статус «${booking.status}»`};
  }

  const schedule=await getOrganizationSchedule(db,organizationId);
  if(!isBookableDate(booking.desiredDate)
    || !isEquipmentDayOpen(booking.desiredDate,schedule,booking.equipmentId)
    || !candidateTimesFor(hoursFor(schedule,booking.equipmentId),booking.durationMinutes).includes(booking.desiredTime)) {
    return {handled:true,callbackId,chatId,ok:false,message:"Час поза розкладом — перенесіть запис у кабінеті"};
  }
  const endTime=addMinutes(booking.desiredTime,booking.durationMinutes);
  const conflict=await db.prepare(
    `SELECT id FROM bookings WHERE organization_id = ? AND equipment_id = ? AND desired_date = ? AND id != ?
     AND status IN ('confirmed','rescheduled') AND desired_time < ?
     AND strftime('%H:%M', desired_time, '+' || duration_minutes || ' minutes') > ? LIMIT 1`,
  ).bind(organizationId,booking.equipmentId,booking.desiredDate,booking.id,endTime,booking.desiredTime).first();
  if(conflict) return {handled:true,callbackId,chatId,ok:false,message:"Цей час уже зайнятий — перенесіть запис у кабінеті"};
  const blocked=await db.prepare(
    `SELECT id FROM equipment_blocks WHERE organization_id = ? AND equipment_id = ? AND blocked_date = ?
     AND start_time < ? AND end_time > ? LIMIT 1`,
  ).bind(organizationId,booking.equipmentId,booking.desiredDate,endTime,booking.desiredTime).first();
  if(blocked) return {handled:true,callbackId,chatId,ok:false,message:"Апарат недоступний у цей час"};

  const updated=await db.prepare(
    "UPDATE bookings SET status = 'confirmed' WHERE organization_id = ? AND id = ? AND status IN ('new','scheduled','rescheduled')",
  ).bind(organizationId,booking.id).run();
  if(updated.meta.changes) {
    const actor=`telegram:${String(callback?.from?.id||"registrar").slice(0,40)}`;
    await db.prepare(
      "INSERT INTO booking_events (organization_id, booking_id, action, details, actor) VALUES (?, ?, 'status_changed', 'confirmed', ?)",
    ).bind(organizationId,booking.id,actor).run();
    const reminder:ReminderBooking={
      id:booking.id,name:booking.name,phone:booking.phone,phoneNormalized:booking.phoneNormalized,
      patientEmail:booking.patientEmail,service:booking.service,
      desiredDate:booking.desiredDate,desiredTime:booking.desiredTime,
    };
    await sendPatientReminder(db,"confirmed",reminder).catch(()=>null);
  }
  return {handled:true,callbackId,chatId,ok:true,message:`✅ Запис ${code} підтверджено`};
}
