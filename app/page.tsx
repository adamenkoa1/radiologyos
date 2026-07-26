"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

const services = [
  { icon: "CT", title: "КТ головного мозку", text: "Головний мозок і кістки черепа без контрастування.", price: "1 400 грн" },
  { icon: "CT", title: "КТ органів грудної клітки", text: "Легені, плевра, середостіння та грудна стінка без контрастування.", price: "1 500 грн" },
  { icon: "CT", title: "КТ черевної порожнини", text: "Органи живота та заочеревинного простору без контрастування.", price: "1 900 грн" },
  { icon: "CT", title: "КТ одного відділу хребта", text: "Шийний, грудний або попереково-крижовий відділ.", price: "1 500 грн" },
  { icon: "XR", title: "Цифрова рентгенографія однієї ділянки", text: "Два стандартні знімки суглоба, кістки або відділу хребта.", price: "500 грн" },
  { icon: "FL", title: "Цифрова флюорографія", text: "Органи грудної клітки, 1 знімок у прямій проєкції та висновок.", price: "300 грн" },
  { icon: "CT+", title: "КТ головного мозку з контрастуванням", text: "Контрастне дослідження за медичними показаннями.", price: "3 200 грн" },
  { icon: "CT+", title: "КТ грудної клітки з контрастуванням", text: "Контрастна оцінка легень, середостіння та грудної стінки.", price: "3 400 грн" },
  { icon: "CTA", title: "КТ-ангіографія однієї ділянки", text: "Контрастне дослідження судин ділянки, визначеної лікарем.", price: "3 600 грн" },
];

const times = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"];

export default function Home() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [bookingCode, setBookingCode] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [availableTimes, setAvailableTimes] = useState(times);
  const [slotsLoading, setSlotsLoading] = useState(false);

  useEffect(() => {
    if (!selectedDate) return;
    let active = true;
    async function loadSlots() {
      setSlotsLoading(true);
      try {
        const response = await fetch(`/api/availability?date=${encodeURIComponent(selectedDate)}`, { cache:"no-store" });
        const data = await response.json() as {times?:string[]};
        if (active) setAvailableTimes(response.ok ? data.times || [] : []);
      } catch {
        if (active) setAvailableTimes([]);
      } finally {
        if (active) setSlotsLoading(false);
      }
    }
    void loadSlots();
    return () => { active = false; };
  }, [selectedDate]);

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
      setAvailableTimes(times);
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
          <a href="#services">Послуги</a><a href="#patients">Пацієнтам</a><a href="/cabinet">Статус заявки</a><a className="staffLogin" href="https://radiologyos-app.adamenko-artem96.chatgpt.site">Вхід для персоналу</a>
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
          {services.map((service) => (
            <article className="serviceCard" key={service.title}>
              <span className="serviceIcon">{service.icon}</span>
              <h3>{service.title}</h3><p>{service.text}</p>
              <div>{service.price ? <b>{service.price}</b> : <span>За чинним тарифом</span>}<a href="#booking">Записатися →</a></div>
            </article>
          ))}
        </div>
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
            <label className="wide"><span>Дослідження *</span><select name="service" required defaultValue=""><option value="" disabled>Оберіть послугу</option>{services.map(s => <option key={s.title}>{s.title}</option>)}</select></label>
            <label><span>Бажана дата *</span><input name="date" type="date" required min={new Date().toISOString().split("T")[0]} onChange={event=>setSelectedDate(event.target.value)} /></label>
            <label><span>Вільний час *</span><select name="time" required defaultValue="" disabled={!selectedDate||slotsLoading}><option value="" disabled>{slotsLoading?"Перевіряємо…":availableTimes.length?"Оберіть час":"Вільного часу немає"}</option>{availableTimes.map(t => <option key={t}>{t}</option>)}</select></label>
            <label className="wide"><span>Статус направлення</span><select name="referral"><option>Є направлення</option><option>Немає направлення</option><option>Уточню у адміністратора</option></select></label>
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

      <footer><p>© {new Date().getFullYear()} Відділення променевої діагностики</p><div className="footerLinks"><Link href="/cabinet">Статус заявки</Link><Link href="/privacy">Конфіденційність</Link><a href="https://radiologyos-app.adamenko-artem96.chatgpt.site">RadiologyOS для персоналу</a></div><p>Онлайн-запис не призначений для невідкладних станів.</p></footer>
    </main>
  );
}
