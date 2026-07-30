"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { groupedServices, serviceByCode, SERVICES } from "../../lib/catalog";
import { todayInKyiv } from "../../lib/booking-rules";

const featuredServices = SERVICES.filter(service => service.featured);
const serviceGroups = groupedServices();
const money = new Intl.NumberFormat("uk-UA");
const equipmentNames: Record<string,string> = {
  ct:"Комп’ютерний томограф", xray:"Цифровий рентген", fluoro:"Флюорограф",
};

export default function BookingPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [bookingCode, setBookingCode] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [serviceCode, setServiceCode] = useState("");
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotDetails, setSlotDetails] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [patientCategory, setPatientCategory] = useState("");
  const [referralType, setReferralType] = useState("");

  const selectedService = serviceByCode(serviceCode);
  const phoneDigits = phone.replace(/\D/g, "");
  const step1Done = !!(serviceCode && selectedDate && selectedTime);
  const step2Done = name.trim().length >= 2 && phoneDigits.length >= 11 && !!patientCategory;
  const step3Done = !!referralType;

  useEffect(() => {
    const category = new URLSearchParams(window.location.search).get("category");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (category === "military" || category === "civilian") setPatientCategory(category);
  }, []);

  function formatPhone(raw:string) {
    let d = raw.replace(/\D/g, "");
    if (d.startsWith("380")) d = d.slice(3); else if (d.startsWith("0")) d = d.slice(1);
    d = d.slice(0, 9);
    if (!d) return "";
    let out = "+380";
    if (d.length) out += ` ${d.slice(0, 2)}`;
    if (d.length > 2) out += ` ${d.slice(2, 5)}`;
    if (d.length > 5) out += ` ${d.slice(5, 7)}`;
    if (d.length > 7) out += ` ${d.slice(7, 9)}`;
    return out;
  }

  function chooseService(code:string) {
    setServiceCode(code);
    setSelectedTime("");
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      document.getElementById("booking")?.scrollIntoView({ behavior:"smooth", block:"start" });
      document.getElementById("bookingDate")?.focus({ preventScroll:true });
    }, 60);
  }

  useEffect(() => {
    if (!selectedDate || !serviceCode) return;
    let active = true;
    async function loadSlots() {
      setSlotsLoading(true);
      setSelectedTime("");
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
      setSelectedDate(""); setSelectedTime(""); setServiceCode("");
      setAvailableTimes([]); setSlotDetails("");
      setName(""); setPhone(""); setPatientCategory(""); setReferralType("");
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Не вдалося надіслати заявку");
      setStatus("error");
    }
  }

  return (
    <main className="publicShell bookingPage">
      <header className="bookingTop">
        <Link className="bookingBack" href="/">← На головну</Link>
        <div className="bookingTopTitle"><b>Чернігівський військовий госпіталь</b><small>Онлайн-запис на дослідження</small></div>
      </header>

      <section className="section" id="services">
        <div className="sectionHead"><div><p className="eyebrow">Послуги</p><h2>Оберіть дослідження</h2></div><p>Остаточну програму дослідження визначає лікар з урахуванням направлення та клінічної ситуації.</p></div>
        <div className="serviceGrid">
          {featuredServices.map((service) => (
            <article className="serviceCard" key={service.code}>
              <span className="serviceIcon">{service.equipmentId === "ct" ? "CT" : service.equipmentId === "xray" ? "XR" : "FL"}</span>
              <h3>{service.title}</h3><p>{service.description}</p>
              <div><b>{money.format(service.price)} грн</b><a href="#booking" onClick={(event)=>{event.preventDefault();chooseService(service.code);}}>Записатися →</a></div>
            </article>
          ))}
        </div>
        <p className="catalogCount">Повний каталог: {SERVICES.length} послуг із внутрішніми кодами та кодами eHealth там, де відповідність визначена.</p>
        <p className="tariffNote">Ціни на сайті мають інформаційний характер. Перед підтвердженням запису адміністратор уточнить вартість відповідно до чинного офіційного тарифу.</p>
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
          <div className="bookingSummary" aria-live="polite">
            <p className="bookingSummaryTitle">Ваше замовлення</p>
            {selectedService ? <>
              <p className="bookingSummaryService">{selectedService.title}</p>
              <ul>
                <li><span>Апарат</span><b>{equipmentNames[selectedService.equipmentId]}</b></li>
                <li><span>Тривалість</span><b>{selectedService.durationMinutes} хв</b></li>
                <li><span>Дата й час</span><b>{selectedDate ? `${selectedDate}${selectedTime ? ` · ${selectedTime}` : ""}` : "не обрано"}</b></li>
                <li className="price"><span>Орієнтовна ціна</span><b>{money.format(selectedService.price)} грн</b></li>
              </ul>
              <small>Остаточну вартість підтвердить адміністратор за чинним тарифом.</small>
            </> : <p className="bookingSummaryEmpty">Оберіть послугу — тут з’явиться підсумок і орієнтовна ціна.</p>}
          </div>
        </div>
        <form className="bookingForm" onSubmit={submitBooking}>
          <div className="formSections">
            <fieldset className="formSection">
              <legend className={step1Done?"done":""}><span>{step1Done?"✓":"1"}</span> Послуга, дата та час</legend>
              <div className="formGrid">
                <label className="wide"><span>Дослідження *</span><select name="serviceCode" required value={serviceCode} onChange={event=>{setServiceCode(event.target.value);setSelectedTime("");}}><option value="" disabled>Оберіть послугу</option>{Object.entries(serviceGroups).map(([group,items])=><optgroup label={group} key={group}>{items.map(service=><option value={service.code} key={service.code}>{service.code} · {service.title} · {money.format(service.price)} грн</option>)}</optgroup>)}</select></label>
                <label><span>Бажана дата *</span><input id="bookingDate" name="date" type="date" required min={todayInKyiv()} value={selectedDate} onChange={event=>{setSelectedDate(event.target.value);setSelectedTime("");}} /></label>
                <label><span>Вільний час *</span><select name="time" required value={selectedTime} onChange={event=>setSelectedTime(event.target.value)} disabled={!selectedDate||!serviceCode||slotsLoading}><option value="" disabled>{!serviceCode?"Спершу оберіть послугу":!selectedDate?"Оберіть дату":slotsLoading?"Перевіряємо…":availableTimes.length?"Оберіть час":"Вільного часу немає"}</option>{availableTimes.map(t => <option key={t}>{t}</option>)}</select>{slotDetails&&<small className="slotDetails">{slotDetails}</small>}</label>
              </div>
            </fieldset>
            <fieldset className="formSection">
              <legend className={step2Done?"done":""}><span>{step2Done?"✓":"2"}</span> Ваші дані</legend>
              <div className="formGrid">
                <label><span>Ім’я та прізвище *</span><input name="name" required minLength={2} autoComplete="name" placeholder="Як до вас звертатися" value={name} onChange={event=>setName(event.target.value)} /></label>
                <label><span>Телефон *</span><input name="phone" required inputMode="tel" autoComplete="tel" placeholder="+380 __ ___ __ __" value={phone} onChange={event=>setPhone(formatPhone(event.target.value))} /></label>
                <label><span>Дата народження *</span><input name="dob" type="date" required max={todayInKyiv()} min="1920-01-01" autoComplete="bday" /><small className="slotDetails">Знадобиться для входу в кабінет пацієнта.</small></label>
                <label className="wide"><span>E-mail (для нагадувань)</span><input name="email" type="email" autoComplete="email" placeholder="name@example.com" /><small className="slotDetails">Необовʼязково. Надішлемо нагадування про підтвердження чи перенесення запису.</small></label>
                <label className="wide"><span>Категорія пацієнта *</span><select name="patientCategory" required value={patientCategory} onChange={event=>setPatientCategory(event.target.value)}><option value="" disabled>Оберіть категорію</option><option value="military">Військовослужбовець</option><option value="civilian">Цивільний пацієнт</option></select></label>
              </div>
            </fieldset>
            <fieldset className="formSection">
              <legend className={step3Done?"done":""}><span>{step3Done?"✓":"3"}</span> Направлення та деталі</legend>
              <div className="formGrid">
                <label><span>Тип направлення *</span><select name="referralType" required value={referralType} onChange={event=>setReferralType(event.target.value)}><option value="" disabled>Оберіть тип</option><option value="military_referral">Направлення військової частини/закладу</option><option value="eh_referral">Електронне направлення</option><option value="paper_referral">Паперове направлення</option><option value="none">Немає направлення</option><option value="other">Інше</option></select></label>
                {referralType && referralType !== "none" ? <label><span>Номер направлення</span><input name="referralNumber" maxLength={80} placeholder="За наявності" /></label> : <input type="hidden" name="referralNumber" value="" />}
                <label><span>Як дізналися про нас</span><select name="marketingSource" defaultValue=""><option value="">Не вказано</option><option value="google">Google</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="recommendation">Рекомендація</option><option value="hospital">Направив медичний заклад</option><option value="other">Інше</option></select></label>
                <label className="wide"><span>Коментар</span><textarea name="comment" rows={3} maxLength={700} placeholder="За потреби вкажіть важливі деталі" /></label>
              </div>
            </fieldset>
          </div>
          <label className="consent"><input type="checkbox" required name="consent" value="yes" /><span>Погоджуюся на обробку контактних даних для організації запису та ознайомився(-лася) з <Link href="/privacy">політикою конфіденційності</Link>.</span></label>
          <button className="button submit" disabled={status === "sending"}>{status === "sending" ? "Надсилаємо…" : "Надіслати заявку →"}</button>
          {status === "success" && <p className="notice success" role="status">Заявку прийнято. Ваш код: <b>{bookingCode}</b>. Очікуйте підтвердження телефоном.</p>}
          {status === "error" && <p className="notice error" role="alert">{bookingError || "Не вдалося надіслати заявку. Спробуйте ще раз або зателефонуйте нам."}</p>}
        </form>
      </section>

      <footer><p>© {new Date().getFullYear()} Відділення променевої діагностики</p><div className="footerLinks"><Link href="/cabinet">Статус заявки</Link><Link href="/privacy">Конфіденційність</Link><Link href="/">На головну</Link></div><p>Онлайн-запис не призначений для невідкладних станів.</p></footer>
    </main>
  );
}
