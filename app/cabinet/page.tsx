"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type Booking = {
  code:string; service:string; desiredDate:string; desiredTime:string; status:string;
  createdAt:string; statusLabel?:string;
};
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
  const [bookings,setBookings] = useState<Booking[]|null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);

  async function lookup(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setBookings(null);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/my-bookings", {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({ phone:String(data.phone||""), dob:String(data.dob||"") }),
    });
    const result = await response.json() as { bookings?:Booking[]; error?:string };
    setLoading(false);
    if (!response.ok) { setError(result.error || "Не вдалося увійти"); return; }
    setBookings(result.bookings || []);
  }

  async function cancelBooking(code:string) {
    const response = await fetch("/api/booking-status", {
      method:"PATCH", headers:{"content-type":"application/json"},
      body:JSON.stringify({ code, action:"cancel" }),
    });
    const result = await response.json() as { error?:string };
    if (!response.ok) { setError(result.error || "Не вдалося скасувати запис"); return; }
    setBookings(list => (list||[]).map(b => b.code===code ? {...b,status:"cancelled"} : b));
  }

  return <main className="cabinetShell">
    <header className="cabinetHead"><Link className="brand" href="/"><span className="brandMark">R</span><span><b>Променева діагностика</b><small>Чернігівський військовий госпіталь</small></span></Link><Link href="/" className="textLink">На головну</Link></header>
    <section className="cabinetHero">
      <div><p className="eyebrow">Кабінет пацієнта</p><h1>Ваші записи<br/><em>та їх статус</em></h1><p>Увійдіть за номером телефону та датою народження, які вказали під час запису.</p></div>
      <form className="lookupForm" onSubmit={lookup}>
        <label><span>Номер телефону</span><input name="phone" required inputMode="tel" autoComplete="tel" placeholder="+380 97 000 00 00"/></label>
        <label><span>Дата народження</span><input name="dob" type="date" required max="2100-12-31" min="1920-01-01" autoComplete="bday"/></label>
        <button className="button" disabled={loading}>{loading?"Входимо…":"Увійти →"}</button>
        {error&&<p className="notice error" role="alert">{error}</p>}
      </form>
    </section>
    {bookings&&(bookings.length===0
      ? <section className="statusResult"><p className="statusHelp">За цими даними записів не знайдено. Перевірте номер і дату народження або зробіть <Link href="/booking">новий запис</Link>.</p></section>
      : <section className="cabinetBookings">
          <p className="eyebrow">Ваші записи</p>
          {bookings.map(booking=><article className="statusResult" key={booking.code}>
            <div className={`statusPill ${booking.status}`}>{booking.statusLabel||labels[booking.status]||booking.status}</div>
            <h2>{booking.service}</h2>
            <div className="statusDetails"><p><small>Бажана дата</small><b>{booking.desiredDate}</b></p><p><small>Час</small><b>{booking.desiredTime}</b></p><p><small>Код</small><b>{booking.code}</b></p></div>
            <p className="statusHelp">{booking.status==="new"?"Працівник відділення опрацьовує заявку та зв’яжеться з вами для підтвердження.":"Якщо потрібне уточнення, зателефонуйте до реєстратури."}</p>
            {["new","confirmed","rescheduled"].includes(booking.status)&&<button className="cancelBooking" onClick={()=>void cancelBooking(booking.code)}>Скасувати запис</button>}
            {booking.status!=="cancelled"&&<div className="personalPrep"><p className="eyebrow">Підготовка до візиту</p><h3>{preparation(booking.service).title}</h3><ul>{preparation(booking.service).items.map(item=><li key={item}>{item}</li>)}</ul><p>Остаточні рекомендації підтвердить працівник відділення з урахуванням направлення та вашої ситуації.</p></div>}
          </article>)}
        </section>)}
    <section className="privacyNote"><b>Безпека даних</b><p>Для входу потрібні два реквізити із заявки — номер телефону та дата народження. Кількість спроб обмежена.</p></section>
  </main>;
}
