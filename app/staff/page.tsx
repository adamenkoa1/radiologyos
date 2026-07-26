"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Booking = {
  id:number; code:string; name:string; phone:string; service:string;
  desiredDate:string; desiredTime:string; referral:string; comment:string;
  status:string; createdAt:string;
};
type BookingEvent = { id:number; bookingId:number; action:string; details:string; actor:string; createdAt:string };
type StaffNote = { bookingId:number; note:string; updatedBy:string; updatedAt:string };

const labels: Record<string,string> = {
  new:"Нова", confirmed:"Підтверджена", rescheduled:"Перенесена",
  completed:"Завершена", cancelled:"Скасована",
};

export default function StaffPage() {
  const [items,setItems] = useState<Booking[]>([]);
  const [events,setEvents] = useState<BookingEvent[]>([]);
  const [notes,setNotes] = useState<StaffNote[]>([]);
  const [error,setError] = useState("");
  const [actionError,setActionError] = useState("");
  const [filter,setFilter] = useState("all");
  const [dayFilter,setDayFilter] = useState("");
  const [query,setQuery] = useState("");

  async function load() {
    const response = await fetch("/api/staff/bookings", { cache:"no-store" });
    const data = await response.json() as { bookings?:Booking[]; events?:BookingEvent[]; notes?:StaffNote[]; error?:string };
    if (!response.ok) { setError(data.error || "Немає доступу"); return; }
    setItems(data.bookings || []); setEvents(data.events || []); setNotes(data.notes || []); setError("");
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function changeStatus(id:number,status:string) {
    setActionError("");
    const response = await fetch("/api/staff/bookings", {
      method:"PATCH", headers:{"content-type":"application/json"},
      body:JSON.stringify({id,status}),
    });
    if (response.ok) setItems(current => current.map(item => item.id === id ? {...item,status} : item));
  }

  async function reschedule(id:number,desiredDate:string,desiredTime:string) {
    setActionError("");
    const response = await fetch("/api/staff/bookings", {
      method:"PATCH", headers:{"content-type":"application/json"},
      body:JSON.stringify({id,desiredDate,desiredTime}),
    });
    const data = await response.json() as { error?:string };
    if (!response.ok) { setActionError(data.error || "Не вдалося перенести запис"); return; }
    setItems(current => current.map(item => item.id === id ? {...item,desiredDate,desiredTime,status:"rescheduled"} : item));
  }
  async function saveNote(id:number,note:string) {
    setActionError("");
    const response = await fetch("/api/staff/bookings", {
      method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({id,note}),
    });
    const data = await response.json() as { error?:string };
    if (!response.ok) { setActionError(data.error || "Не вдалося зберегти нотатку"); return; }
    setNotes(current => [...current.filter(item=>item.bookingId!==id),{bookingId:id,note,updatedBy:"ви",updatedAt:new Date().toISOString()}]);
  }

  const visible = useMemo(() => items
    .filter(item => filter === "all" || item.status === filter)
    .filter(item => !dayFilter || item.desiredDate === dayFilter)
    .filter(item => !query.trim() || `${item.name} ${item.phone} ${item.code} ${item.service}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a,b)=>`${a.desiredDate} ${a.desiredTime}`.localeCompare(`${b.desiredDate} ${b.desiredTime}`)), [items,filter,dayFilter,query]);
  const today = new Date().toISOString().slice(0,10);

  return <main className="staffShell">
    <header className="staffHead">
      <div><p className="eyebrow">RadiologyOS · персонал</p><h1>Черга онлайн-заявок</h1></div>
      <Link className="button compact" href="/">Публічний сайт</Link>
    </header>
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p></section> :
    <>
      <section className="staffStats">
        <article><span>Усього</span><b>{items.length}</b></article>
        <article><span>Нові</span><b>{items.filter(i=>i.status==="new").length}</b></article>
        <article><span>На сьогодні</span><b>{items.filter(i=>i.desiredDate===today).length}</b></article>
        <article><span>Підтверджені</span><b>{items.filter(i=>i.status==="confirmed").length}</b></article>
      </section>
      <div className="staffTools">
        <label>Статус <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Усі заявки</option>{Object.entries(labels).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
        <label>Дата <input type="date" value={dayFilter} onChange={e=>setDayFilter(e.target.value)}/></label>
        <label>Пошук <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Код, ім’я, телефон"/></label>
        <div className="toolButtons"><button onClick={()=>{setDayFilter(today);setFilter("all")}}>Сьогодні</button><button onClick={()=>window.print()}>Друк</button><button onClick={()=>void load()}>Оновити</button></div>
      </div>
      <p className="scheduleCaption">{dayFilter?`Розклад на ${dayFilter}`:"Усі дати"} · {visible.length} записів</p>
      {actionError&&<p className="staffError" role="alert">{actionError}</p>}
      <section className="bookingList">
        {visible.length === 0 && <p className="empty">Заявок у цій категорії немає.</p>}
        {visible.map(item => <article className="bookingRow" key={item.id}>
          <div className="bookingPrimary"><span className={`statusTag ${item.status}`}>{labels[item.status] || item.status}</span><b>{item.name}</b><small>{item.code} · отримано {new Date(item.createdAt).toLocaleString("uk-UA")}</small></div>
          <div><small>Дослідження</small><b>{item.service}</b><span>{item.desiredDate} · {item.desiredTime}</span></div>
          <div><small>Контакт</small><a href={`tel:${item.phone}`}>{item.phone}</a><span>{item.referral}</span></div>
          <div className="bookingAction"><small>Статус</small><select value={item.status} onChange={e=>void changeStatus(item.id,e.target.value)}>{Object.entries(labels).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></div>
          <form className="rescheduleForm" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void reschedule(item.id,String(data.get("date")),String(data.get("time")));}}>
            <small>Перенести запис</small>
            <input name="date" type="date" required defaultValue={item.desiredDate}/>
            <input name="time" type="time" required min="08:00" max="16:30" step="1800" defaultValue={item.desiredTime}/>
            <button type="submit">Зберегти новий час</button>
          </form>
          {item.comment && <p className="bookingComment">{item.comment}</p>}
          <form className="staffNoteForm" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void saveNote(item.id,String(data.get("note")));}}>
            <label><small>Внутрішня нотатка персоналу</small><textarea name="note" maxLength={1200} defaultValue={notes.find(note=>note.bookingId===item.id)?.note||""} placeholder="Підготовка, уточнення направлення, домовленості…"/></label>
            <button type="submit">Зберегти нотатку</button>
            {notes.find(note=>note.bookingId===item.id)&&<span>Оновлено: {new Date(notes.find(note=>note.bookingId===item.id)!.updatedAt).toLocaleString("uk-UA")}</span>}
          </form>
          <details className="bookingHistory">
            <summary>Історія змін ({events.filter(event=>event.bookingId===item.id).length})</summary>
            {events.filter(event=>event.bookingId===item.id).length===0?<p>Змін ще не зафіксовано.</p>:
              <ol>{events.filter(event=>event.bookingId===item.id).map(event=><li key={event.id}><b>{event.action==="rescheduled"?"Перенесено":event.action==="cancelled"?"Скасовано":event.action==="staff_note"?"Оновлено нотатку":"Змінено статус"}</b><span>{event.details}</span><small>{new Date(event.createdAt).toLocaleString("uk-UA")} · {event.actor==="patient"?"пацієнт":event.actor}</small></li>)}</ol>}
          </details>
        </article>)}
      </section>
    </>}
  </main>;
}
