"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type StatusResult = { code:string; service:string; desiredDate:string; desiredTime:string; status:string; createdAt:string };
const labels:Record<string,string> = {
  new:"Заявку отримано", confirmed:"Запис підтверджено", rescheduled:"Запис перенесено",
  completed:"Дослідження завершено", cancelled:"Запис скасовано",
};
function preparation(service:string) {
  const lower = service.toLowerCase();
  if (lower.includes("контраст") || lower.includes("ангіограф")) return {
    title:"КТ із контрастуванням",
    items:["Уточніть у реєстратури, чи потрібно тимчасово утриматися від їжі та пиття.","Завчасно повідомте лікаря про алергії, захворювання нирок, усі ліки та можливу вагітність.","Візьміть направлення і попередні висновки. Не змінюйте ліки самостійно — лише за вказівкою лікаря."],
  };
  if (lower.includes("рентген") || lower.includes("флюор")) return {
    title:"Рентгенографія або флюорографія",
    items:["Спеціальна підготовка зазвичай не потрібна.","Залиште вдома прикраси або будьте готові зняти металеві предмети в ділянці дослідження.","Повідомте працівника про можливу вагітність."],
  };
  return {
    title:"КТ без контрастування",
    items:["Для більшості таких досліджень спеціальна підготовка не потрібна.","Візьміть направлення, попередні висновки та зображення, якщо вони є.","Перед візитом виконайте інструкції, які надасть працівник відділення."],
  };
}

export default function CabinetPage() {
  const [booking,setBooking] = useState<StatusResult|null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);
  const [credentials,setCredentials] = useState({code:"",phone:""});
  async function lookup(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setBooking(null);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setCredentials({code:String(data.code||""),phone:String(data.phone||"")});
    const response = await fetch("/api/booking-status", {
      method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(data),
    });
    const result = await response.json() as { booking?:StatusResult; error?:string };
    setLoading(false);
    if (!response.ok) setError(result.error || "Не вдалося перевірити заявку");
    else setBooking(result.booking || null);
  }
  async function cancelBooking() {
    if (!booking) return;
    const response = await fetch("/api/booking-status", {
      method:"PATCH", headers:{"content-type":"application/json"},
      body:JSON.stringify({...credentials,action:"cancel"}),
    });
    const result = await response.json() as { error?:string };
    if (!response.ok) { setError(result.error || "Не вдалося скасувати заявку"); return; }
    setBooking({...booking,status:"cancelled"});
  }
  return <main className="cabinetShell">
    <header className="cabinetHead"><Link className="brand" href="/"><span className="brandMark">R</span><span><b>Променева діагностика</b><small>Чернігівський військовий госпіталь</small></span></Link><Link href="/" className="textLink">На головну</Link></header>
    <section className="cabinetHero">
      <div><p className="eyebrow">Кабінет пацієнта</p><h1>Перевірте статус<br/><em>своєї заявки</em></h1><p>Введіть код, отриманий після онлайн-запису, та повний номер телефону із заявки.</p></div>
      <form className="lookupForm" onSubmit={lookup}>
        <label><span>Код заявки</span><input name="code" required placeholder="RD-XXXXXXXX" autoCapitalize="characters"/></label>
        <label><span>Повний номер телефону</span><input name="phone" required inputMode="tel" autoComplete="tel" placeholder="+380 97 000 00 00"/></label>
        <button className="button" disabled={loading}>{loading?"Перевіряємо…":"Перевірити статус →"}</button>
        {error&&<p className="notice error" role="alert">{error}</p>}
      </form>
    </section>
    {booking&&<section className="statusResult">
      <p className="eyebrow">Результат перевірки</p>
      <div className={`statusPill ${booking.status}`}>{labels[booking.status]||booking.status}</div>
      <h2>{booking.service}</h2>
      <div className="statusDetails"><p><small>Бажана дата</small><b>{booking.desiredDate}</b></p><p><small>Час</small><b>{booking.desiredTime}</b></p><p><small>Код</small><b>{booking.code}</b></p></div>
      <p className="statusHelp">{booking.status==="new"?"Працівник відділення опрацьовує заявку та зв’яжеться з вами для підтвердження.":"Якщо потрібне уточнення, зателефонуйте до реєстратури."}</p>
      {["new","confirmed","rescheduled"].includes(booking.status)&&<button className="cancelBooking" onClick={()=>void cancelBooking()}>Скасувати запис</button>}
      {booking.status!=="cancelled"&&<div className="personalPrep"><p className="eyebrow">Підготовка до візиту</p><h3>{preparation(booking.service).title}</h3><ul>{preparation(booking.service).items.map(item=><li key={item}>{item}</li>)}</ul><p>Остаточні рекомендації підтвердить працівник відділення з урахуванням направлення та вашої ситуації.</p></div>}
    </section>}
    <section className="privacyNote"><b>Безпека даних</b><p>Сторінка не показує ім’я, номер телефону, коментарі або медичні документи. Для перевірки потрібні два окремі реквізити заявки.</p></section>
  </main>;
}
