"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { todayInKyiv } from "../lib/booking-rules";
import { groupedServices, SERVICES } from "../lib/catalog";

const serviceGroups = groupedServices();
const featuredServices = SERVICES.filter((service) => service.featured).slice(0, 6);
const money = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 });

const rooms = [
  {
    number: "01",
    title: "Кабінет комп’ютерної томографії",
    floor: "1 поверх",
    equipment: "Siemens SOMATOM go.Up",
    text: "КТ без контрастування, з контрастуванням та КТ-ангіографія за медичними показаннями.",
  },
  {
    number: "02",
    title: "Рентгенологічний кабінет №1",
    floor: "2 поверх",
    equipment: "Sireskop CX та цифрові рентген-системи",
    text: "Рентгенографія, рентгеноскопія та дослідження з функціональними пробами.",
  },
  {
    number: "03",
    title: "Рентгенологічний кабінет №2",
    floor: "2 поверх",
    equipment: "HYPERION X9 Pro, RXDC, IMAX 6000",
    text: "Панорамна й внутрішньоротова рентгенографія та цифрова діагностика.",
  },
  {
    number: "04",
    title: "Флюорографічний кабінет",
    floor: "Стаціонарний прийом",
    equipment: "Цифровий комплекс 12Ф9 Україна",
    text: "Цифрова флюорографія органів грудної клітки з підготовкою висновку.",
  },
];

const patientSteps = [
  ["1", "Реєстрація", "Вкажіть телефон, email і дані пацієнта."],
  ["2", "Онлайн-запис", "Оберіть дослідження, дату та бажаний час."],
  ["3", "Підтвердження", "Адміністратор перевірить направлення і зв’яжеться з вами."],
  ["4", "Візит", "Приходьте в погоджений час; цивільні пацієнти оплачують послугу."],
  ["5", "Дослідження", "Персонал проводить дослідження та готує висновок."],
  ["6", "Результат", "Отримайте результат у відділенні або на вказаний email."],
];

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "success"; codes: string[] }
  | { kind: "error"; message: string };

export default function Home() {
  const [category, setCategory] = useState<"military" | "civilian">("military");
  const [serviceCode, setServiceCode] = useState(featuredServices[0]?.code || SERVICES[0].code);
  const [desiredDate, setDesiredDate] = useState("");
  const [times, setTimes] = useState<string[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  const selectedService = useMemo(
    () => SERVICES.find((service) => service.code === serviceCode) || SERVICES[0],
    [serviceCode],
  );

  useEffect(() => {
    if (!desiredDate || !serviceCode) return;
    const controller = new AbortController();
    fetch(`/api/availability?date=${encodeURIComponent(desiredDate)}&serviceCode=${encodeURIComponent(serviceCode)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => response.ok ? response.json() as Promise<{ times?: string[] }> : { times: [] })
      .then((data) => setTimes(Array.isArray(data.times) ? data.times : []))
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setTimes([]);
      });
    return () => controller.abort();
  }, [desiredDate, serviceCode]);

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSubmitState({ kind: "sending" });

    try {
      const response = await fetch("/api/site-booking", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: data.get("name"),
          phone: data.get("phone"),
          email: data.get("email"),
          dob: data.get("dob"),
          category,
          referralType: data.get("referralType"),
          desiredDate: data.get("desiredDate"),
          desiredTime: data.get("desiredTime"),
          resultDelivery: data.get("resultDelivery"),
          comment: data.get("comment"),
          source: "unified_home",
          consent: data.get("consent") === "on",
          consentVersion: "2026-07-29",
          items: [{ code: serviceCode }],
        }),
      });
      const result = await response.json() as { error?: string; codes?: string[]; code?: string };
      if (!response.ok) throw new Error(result.error || "Не вдалося надіслати заявку");
      const codes = result.codes?.length ? result.codes : result.code ? [result.code] : [];
      setSubmitState({ kind: "success", codes });
      form.reset();
      setDesiredDate("");
      setTimes([]);
    } catch (error) {
      setSubmitState({ kind: "error", message: error instanceof Error ? error.message : "Не вдалося надіслати заявку" });
    }
  }

  return (
    <main className="hospitalHome" id="top">
      <header className="hospitalHeader">
        <a className="hospitalBrand" href="#top" aria-label="На початок сторінки">
          <Image src="/hospital-emblem.jpg" alt="Герб Чернігівського військового госпіталю" width={382} height={382} priority unoptimized />
          <span><b>Чернігівський військовий госпіталь</b><small>Відділення променевої діагностики</small></span>
        </a>
        <nav className="hospitalNav" aria-label="Головна навігація">
          <a href="#department">Відділення</a>
          <a href="#rooms">Кабінети</a>
          <a href="#services">Послуги</a>
          <a href="#schedule">Графік</a>
        </nav>
        <a className="hospitalHeaderCta" href="#booking">Записатися</a>
      </header>

      <section className="hospitalHero" aria-labelledby="hero-title">
        <div className="hospitalHeroCopy">
          <span className="hospitalEyebrow">Променева діагностика у Чернігові</span>
          <h1 id="hero-title">Дослідження, запис і результат — в одному місці</h1>
          <p>Комп’ютерна томографія, цифрова рентгенографія та флюорографія для військовослужбовців і цивільних пацієнтів.</p>
          <div className="hospitalHeroActions">
            <a className="hospitalPrimary" href="#booking">Онлайн-запис</a>
            <a className="hospitalSecondary" href="tel:+380972808899">+380 97 280 88 99</a>
          </div>
          <ul className="hospitalTrust">
            <li><b>Пн–Сб</b><span>плановий прийом</span></li>
            <li><b>4 кабінети</b><span>КТ та рентген</span></li>
            <li><b>Email</b><span>видача результату за вибором</span></li>
          </ul>
        </div>
        <div className="hospitalHeroMark" aria-hidden="true">
          <div className="hospitalMarkRing"><Image src="/hospital-emblem.jpg" alt="" width={382} height={382} priority unoptimized /></div>
          <span>Відділення<br />променевої<br />діагностики</span>
        </div>
      </section>

      <section className="hospitalAudience" aria-label="Умови обслуговування">
        <article className="hospitalAudienceCard military">
          <span className="hospitalAudienceIndex">01</span>
          <div><p>Військовослужбовцям</p><h2>Безоплатно</h2><span>За направленням та після підтвердження запису.</span></div>
          <a href="#booking" onClick={() => setCategory("military")}>Запис для військових <span aria-hidden="true">→</span></a>
        </article>
        <article className="hospitalAudienceCard civilian">
          <span className="hospitalAudienceIndex">02</span>
          <div><p>Цивільним пацієнтам</p><h2>За офіційними тарифами</h2><span>Вартість залежить від виду дослідження; оплата під час візиту.</span></div>
          <a href="#booking" onClick={() => setCategory("civilian")}>Переглянути ціни й записатися <span aria-hidden="true">→</span></a>
        </article>
      </section>

      <section className="hospitalSection hospitalDepartment" id="department">
        <div className="hospitalSectionIntro">
          <span className="hospitalKicker">Про відділення</span>
          <h2>Спеціалізована діагностика в структурі госпіталю</h2>
        </div>
        <div className="hospitalDepartmentGrid">
          <p className="hospitalLead">Відділення забезпечує планові дослідження для військовослужбовців і цивільних пацієнтів, а також діагностичну підтримку підрозділів госпіталю.</p>
          <div className="hospitalFacts">
            <div><b>КТ</b><span>без контрасту, з контрастуванням, ангіографія</span></div>
            <div><b>Рентген</b><span>цифрові знімки та рентгеноскопія</span></div>
            <div><b>ФЛГ</b><span>цифрова флюорографія грудної клітки</span></div>
          </div>
        </div>
      </section>

      <section className="hospitalSection hospitalRooms" id="rooms">
        <div className="hospitalSectionIntro split">
          <div><span className="hospitalKicker">Кабінети й обладнання</span><h2>Діагностичні можливості</h2></div>
          <p>Стаціонарні цифрові системи для базових і розширених рентгенологічних досліджень.</p>
        </div>
        <div className="hospitalRoomGrid">
          {rooms.map((room) => (
            <article className="hospitalRoomCard" key={room.number}>
              <div className="hospitalRoomTop"><span>{room.number}</span><small>{room.floor}</small></div>
              <h3>{room.title}</h3>
              <b>{room.equipment}</b>
              <p>{room.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="hospitalTeam" id="team">
        <div>
          <span className="hospitalKicker light">Команда</span>
          <h2>Дослідження проводить профільний медичний персонал</h2>
          <p>Начальник відділення — Дмитро Адаменко. У команді працюють лікарі-рентгенологи, рентгенолаборанти та молодший медичний персонал.</p>
        </div>
        <div className="hospitalTeamBadge"><b>01</b><span>єдина команда<br />від запису до результату</span></div>
      </section>

      <section className="hospitalSection hospitalServices" id="services">
        <div className="hospitalSectionIntro split">
          <div><span className="hospitalKicker">Послуги</span><h2>Найчастіші дослідження</h2></div>
          <p>Для цивільних пацієнтів вказана чинна базова вартість. Остаточний обсяг дослідження визначається за направленням.</p>
        </div>
        <div className="hospitalServiceGrid">
          {featuredServices.map((service) => (
            <article className="hospitalServiceCard" key={service.code}>
              <div><span>{service.group}</span><small>{service.durationMinutes} хв</small></div>
              <h3>{service.title}</h3>
              <p>{service.description}</p>
              <footer><b>{money.format(service.price)}</b><a href="#booking" onClick={() => { setServiceCode(service.code); setCategory("civilian"); }}>Обрати</a></footer>
            </article>
          ))}
        </div>
      </section>

      <section className="hospitalSection hospitalSchedule" id="schedule">
        <div className="hospitalSectionIntro"><span className="hospitalKicker">Режим роботи</span><h2>Плановий амбулаторний прийом</h2></div>
        <div className="hospitalScheduleGrid">
          <div><span>Комп’ютерна томографія</span><b>08:00–17:00</b><small>перерва 13:00–14:00</small></div>
          <div><span>Цифровий рентген</span><b>10:00–15:00</b><small>перерва 13:00–14:00</small></div>
          <div><span>Флюорографія</span><b>09:30–16:00</b><small>перерва 13:00–14:00</small></div>
          <div className="hospitalScheduleDays"><span>Робочі дні</span><b>Понеділок — субота</b><small>Неділя — вихідний для планового запису</small></div>
        </div>
      </section>

      <section className="hospitalSection hospitalJourney">
        <div className="hospitalSectionIntro"><span className="hospitalKicker">Шлях пацієнта</span><h2>Як проходить запис і дослідження</h2></div>
        <ol className="hospitalJourneyGrid">
          {patientSteps.map(([number, title, text]) => <li key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></li>)}
        </ol>
      </section>

      <section className="hospitalBooking" id="booking">
        <div className="hospitalBookingIntro">
          <span className="hospitalKicker light">Онлайн-запис</span>
          <h2>Залиште заявку на дослідження</h2>
          <p>Заповнення форми не є автоматичним підтвердженням. Адміністратор перевірить дані та зв’яжеться з вами.</p>
          <div className="hospitalBookingContact">
            <span>Потрібна допомога?</span>
            <a href="tel:+380972808899">+380 97 280 88 99</a>
            <small>м. Чернігів, вул. Полуботка, 40</small>
          </div>
        </div>

        <form className="hospitalBookingForm" onSubmit={submitBooking}>
          <fieldset className="hospitalCategoryChoice">
            <legend>Категорія пацієнта</legend>
            <label className={category === "military" ? "active" : ""}><input type="radio" name="category" value="military" checked={category === "military"} onChange={() => setCategory("military")} /><span><b>Військовий</b><small>безоплатно за направленням</small></span></label>
            <label className={category === "civilian" ? "active" : ""}><input type="radio" name="category" value="civilian" checked={category === "civilian"} onChange={() => setCategory("civilian")} /><span><b>Цивільний</b><small>за офіційним тарифом</small></span></label>
          </fieldset>

          <div className="hospitalFormGrid">
            <label className="wide">Дослідження<select name="serviceCode" value={serviceCode} onChange={(event) => { setServiceCode(event.target.value); setTimes([]); }} required>
              {Object.entries(serviceGroups).map(([group, services]) => <optgroup label={group} key={group}>{services.map((service) => <option value={service.code} key={service.code}>{service.title} — {money.format(service.price)}</option>)}</optgroup>)}
            </select></label>
            <div className="hospitalSelectedPrice wide"><span>{selectedService.description}</span><b>{category === "military" ? "Безоплатно за направленням" : money.format(selectedService.price)}</b></div>

            <label>ПІБ пацієнта<input name="name" autoComplete="name" maxLength={120} required /></label>
            <label>Дата народження<input name="dob" type="date" autoComplete="bday" required /></label>
            <label>Телефон<input name="phone" type="tel" autoComplete="tel" placeholder="+380 00 000 00 00" required /></label>
            <label>Email<input name="email" type="email" autoComplete="email" placeholder="name@example.com" required /></label>
            <label>Дата візиту<input name="desiredDate" type="date" min={todayInKyiv()} value={desiredDate} onChange={(event) => { setDesiredDate(event.target.value); setTimes([]); }} required /></label>
            <label>Бажаний час<select name="desiredTime" defaultValue="">
              <option value="">Узгодити з адміністратором</option>
              {times.map((time) => <option value={time} key={time}>{time}</option>)}
            </select></label>
            <label>Тип направлення<select name="referralType" defaultValue={category === "military" ? "military_referral" : "paper_referral"} key={category} required>
              {category === "military" && <option value="military_referral">Направлення військової частини / лікаря</option>}
              <option value="eh_referral">Електронне направлення</option>
              <option value="paper_referral">Паперове направлення</option>
              <option value="none">Без направлення</option>
              <option value="other">Інше</option>
            </select></label>
            <label>Отримання результату<select name="resultDelivery" defaultValue="email" required>
              <option value="email">Надіслати на email</option>
              <option value="department">Отримати у відділенні</option>
            </select></label>
            <label className="wide">Коментар<textarea name="comment" maxLength={520} rows={3} placeholder="Наприклад: номер направлення або зручний час для дзвінка" /></label>
          </div>

          <label className="hospitalConsent"><input type="checkbox" name="consent" required /><span>Погоджуюся на обробку персональних і медичних даних для організації запису та отримання результату.</span></label>
          <button className="hospitalSubmit" type="submit" disabled={submitState.kind === "sending"}>{submitState.kind === "sending" ? "Надсилаємо…" : "Надіслати заявку"}</button>

          {submitState.kind === "error" && <p className="hospitalFormMessage error" role="alert">{submitState.message}</p>}
          {submitState.kind === "success" && <div className="hospitalFormMessage success" role="status"><b>Заявку прийнято</b><span>Код: {submitState.codes.join(", ")}</span><a href="/site/cabinet.html">Відкрити кабінет пацієнта</a></div>}
        </form>
      </section>

      <footer className="hospitalFooter">
        <div className="hospitalBrand footer"><Image src="/hospital-emblem.jpg" alt="" width={382} height={382} unoptimized /><span><b>Чернігівський військовий госпіталь</b><small>Відділення променевої діагностики</small></span></div>
        <div><b>Контакти</b><a href="tel:+380972808899">+380 97 280 88 99</a><a href="https://maps.google.com/?q=Чернігів,+вул.+Полуботка,+40" target="_blank" rel="noopener noreferrer">м. Чернігів, вул. Полуботка, 40</a></div>
        <div><b>Пацієнтам</b><a href="#services">Послуги й тарифи</a><a href="#booking">Онлайн-запис</a><a href="/site/cabinet.html">Кабінет пацієнта</a></div>
        <div><b>Система</b><a href="/staff/login">Вхід для персоналу</a><span>Онлайн-запис не призначений для невідкладних станів.</span></div>
      </footer>
    </main>
  );
}
