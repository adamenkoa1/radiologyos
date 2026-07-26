"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { groupedServices, SERVICES } from "../lib/catalog";
import { todayInKyiv } from "../lib/booking-rules";

const featuredServices = SERVICES.filter(service => service.featured);
const serviceGroups = groupedServices();
const money = new Intl.NumberFormat("uk-UA");

export default function Home() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [bookingCode, setBookingCode] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [serviceCode, setServiceCode] = useState("");
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotDetails, setSlotDetails] = useState("");

  useEffect(() => {
    if (!selectedDate || !serviceCode) return;
    let active = true;
    async function loadSlots() {
      setSlotsLoading(true);
      try {
        const response = await fetch(`/api/availability?date=${encodeURIComponent(selectedDate)}&serviceCode=${encodeURIComponent(serviceCode)}`, { cache:"no-store" });
        const data = await response.json() as {times?:string[];durationMinutes?:number;equipment?:string};
        if (active) setAvailableTimes(response.ok ? data.times || [] : []);
        if (active) setSlotDetails(response.ok && data.equipment ? `${data.equipment} · ${data.durationMinutes} хв` : "");
      } catch {
        if (active) setAvailableTimes([]);
      } finally {
        if (active) setSlotsLoading(false);
      }
    }
    void loadSlots();
    return () => { active = false; };
  }, [selectedDate, serviceCode]);

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setBookingError("");
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = (await response.json()) as { code?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Не вдалося надіслати заявку");
      setBookingCode(result.code || "");
      setStatus("success");
      form.reset();
      setSelectedDate("");
      setServiceCode("");
      setAvailableTimes([]);
      setSlotDetails("");
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Не вдалося надіслати заявку");
      setStatus("error");
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="На головну">
          <span className="brandMark">R</span>
          <span><b>Променева діагностика</b><small>Чернігівський військовий госпіталь</small></span>
        </a>
        <nav aria-label="Головна навігація">
          <a href="#services">Послуги</a><a href="#patients">Пацієнтам</a><a href="/cabinet">Статус заявки</a><a className="staffLogin" href="/staff">Вхід для персоналу</a>
        </nav>
        <a className="button compact" href="#booking">Записатися</a>
      </header>

      <section className="hero" id="top">
        <div className="heroCopy">
          <p className="eyebrow"><span /> Відділення променевої діагностики</p>
          <h1>Точне дослідження.<br /><em>Зрозумілий маршрут.</em></h1>
          <p className="lead">КТ, цифрова рентгенографія та флюорографія у Чернігові. Оберіть послугу й залиште заявку на зручний час.</p>
          <div className="heroActions">
            <a className="button" href="#booking">Записатися онлайн <span>→</span></a>
            <a className="textLink" href="tel:+380972808899">+380 97 280 88 99</a>
          </div>
          <div className="facts">
            <div><b>08:00–17:00</b><span>Пн–Сб</span></div>
            <div><b>КТ • Рентген • ФЛГ</b><span>Цифрові дослідження</span></div>
            <div><b>вул. Полуботка, 40</b><span>м. Чернігів</span></div>
          </div>
        </div>
        <div className="heroVisual" aria-hidden="true">
          <div className="scanOrb"><span /><i /></div>
          <p>Діагностика, якій<br />можна довіряти</p>
        </div>
      </section>

      <section className="section" id="services">
        <div className="sectionHead"><div><p className="eyebrow">Послуги</p><h2>Оберіть дослідження</h2></div><p>Остаточну програму дослідження визначає лікар з урахуванням направлення та клінічної ситуації.</p></div>
        <div className="serviceGrid">
          {featuredServices.map((service) => (
            <article className="serviceCard" key={service.code}>
              <span className="serviceIcon">{service.equipmentId === "ct" ? "CT" : service.equipmentId === "xray" ? "XR" : "FL"}</span>
              <h3>{service.title}</h3><p>{service.description}</p>
              <div><b>{money.format(service.price)} грн</b><a href="#booking" onClick={()=>setServiceCode(service.code)}>Записатися →</a></div>
            </article>
          ))}
        </div>
        <p className="catalogCount">Повний каталог: {SERVICES.length} послуг із внутрішніми кодами та кодами eHealth там, де відповідність визначена.</p>
        <p className="tariffNote">Ціни на сайті мають інформаційний характер. Перед підтвердженням запису адміністратор уточнить вартість відповідно до чинного офіційного тарифу.</p>
      </section>

      <section className="patientBand" id="patients">
        <div><p className="eyebrow light">Пацієнтам</p><h2>Для військових і цивільних</h2></div>
        <article><span>01</span><div><h3>Військовослужбовцям</h3><p>Дослідження за направленням та відповідно до встановленого порядку надання медичної допомоги.</p></div></article>
        <article><span>02</span><div><h3>Цивільним пацієнтам</h3><p>Платні діагностичні послуги за чинними офіційними тарифами.</p></div></article>
      </section>

      <section className="section prepSection" id="preparation">
        <div className="sectionHead"><div><p className="eyebrow">Підготовка</p><h2>Перед дослідженням</h2></div><p>Точні рекомендації залежать від ділянки та необхідності контрастування. Працівник відділення уточнить їх під час підтвердження запису.</p></div>
        <div className="prepGrid">
          <article><span>01</span><h3>Візьміть направлення</h3><p>Підготуйте попередні висновки та зображення КТ, МРТ або рентгенографії, якщо вони є.</p></article>
          <article><span>02</span><h3>КТ без контрасту</h3><p>Для більшості досліджень спеціальна підготовка не потрібна. Дотримуйтеся інструкцій, отриманих під час запису.</p></article>
          <article><span>03</span><h3>КТ із контрастом</h3><p>Проводиться за медичними показаннями. Завчасно повідомте про алергії, вагітність і відомі захворювання нирок.</p></article>
        </div>
        <div className="included"><b>У тариф входить:</b><span>проведення дослідження</span><span>обробка та реконструкції</span><span>оцінка лікарем-рентгенологом</span><span>письмовий висновок</span></div>
      </section>

      <section className="section bookingSection" id="booking">
        <div className="bookingIntro">
          <p className="eyebrow">Онлайн-запис</p>
          <h2>Залиште заявку<br />на дослідження</h2>
          <p>Це заявка на бажаний час. Працівник відділення зв’яжеться з вами для уточнення підготовки та остаточного підтвердження.</p>
          <div className="steps"><span>1</span><p><b>Заповніть форму</b><small>Оберіть послугу, дату та час.</small></p><span>2</span><p><b>Дочекайтеся дзвінка</b><small>Ми підтвердимо запис і деталі.</small></p></div>
        </div>
        <form className="bookingForm" onSubmit={submitBooking}>
          <div className="formGrid">
            <label><span>Ім’я та прізвище *</span><input name="name" required minLength={2} autoComplete="name" placeholder="Як до вас звертатися" /></label>
            <label><span>Телефон *</span><input name="phone" required inputMode="tel" autoComplete="tel" placeholder="+380 __ ___ __ __" /></label>
            <label><span>Категорія пацієнта *</span><select name="patientCategory" required defaultValue=""><option value="" disabled>Оберіть категорію</option><option value="military">Військовослужбовець</option><option value="civilian">Цивільний пацієнт</option></select></label>
            <label><span>Тип направлення *</span><select name="referralType" required defaultValue=""><option value="" disabled>Оберіть тип</option><option value="military_referral">Направлення військової частини/закладу</option><option value="eh_referral">Електронне направлення</option><option value="paper_referral">Паперове направлення</option><option value="none">Немає направлення</option><option value="other">Інше</option></select></label>
            <label className="wide"><span>Дослідження *</span><select name="serviceCode" required value={serviceCode} onChange={event=>setServiceCode(event.target.value)}><option value="" disabled>Оберіть послугу</option>{Object.entries(serviceGroups).map(([group,items])=><optgroup label={group} key={group}>{items.map(service=><option value={service.code} key={service.code}>{service.code} · {service.title} · {money.format(service.price)} грн</option>)}</optgroup>)}</select></label>
            <label><span>Бажана дата *</span><input name="date" type="date" required min={todayInKyiv()} onChange={event=>setSelectedDate(event.target.value)} /></label>
            <label><span>Вільний час *</span><select name="time" required defaultValue="" disabled={!selectedDate||!serviceCode||slotsLoading}><option value="" disabled>{slotsLoading?"Перевіряємо…":availableTimes.length?"Оберіть час":"Вільного часу немає"}</option>{availableTimes.map(t => <option key={t}>{t}</option>)}</select>{slotDetails&&<small className="slotDetails">{slotDetails}</small>}</label>
            <label><span>Номер направлення</span><input name="referralNumber" maxLength={80} placeholder="За наявності" /></label>
            <label><span>Як дізналися про нас</span><select name="marketingSource" defaultValue=""><option value="">Не вказано</option><option value="google">Google</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="recommendation">Рекомендація</option><option value="hospital">Направив медичний заклад</option><option value="other">Інше</option></select></label>
            <label className="wide"><span>Коментар</span><textarea name="comment" rows={3} maxLength={700} placeholder="За потреби вкажіть важливі деталі" /></label>
          </div>
          <label className="consent"><input type="checkbox" required name="consent" value="yes" /><span>Погоджуюся на обробку контактних даних для організації запису та ознайомився(-лася) з <Link href="/privacy">політикою конфіденційності</Link>.</span></label>
          <button className="button submit" disabled={status === "sending"}>{status === "sending" ? "Надсилаємо…" : "Надіслати заявку →"}</button>
          {status === "success" && <p className="notice success" role="status">Заявку прийнято. Ваш код: <b>{bookingCode}</b>. Очікуйте підтвердження телефоном.</p>}
          {status === "error" && <p className="notice error" role="alert">{bookingError || "Не вдалося надіслати заявку. Спробуйте ще раз або зателефонуйте нам."}</p>}
        </form>
      </section>

      <section className="contacts" id="contacts">
        <div><p className="eyebrow light">Контакти</p><h2>Ми у Чернігові</h2></div>
        <div><small>Адреса</small><b>м. Чернігів,<br />вул. Полуботка, 40</b></div>
        <div><small>Телефон</small><a href="tel:+380972808899">+380 97 280 88 99</a></div>
        <div><small>Графік</small><b>Пн–Сб<br />08:00–17:00</b></div>
      </section>

      <footer><p>© {new Date().getFullYear()} Відділення променевої діагностики</p><div className="footerLinks"><Link href="/cabinet">Статус заявки</Link><Link href="/privacy">Конфіденційність</Link><Link href="/staff">RadiologyOS для персоналу</Link></div><p>Онлайн-запис не призначений для невідкладних станів.</p></footer>
    </main>
  );
}
