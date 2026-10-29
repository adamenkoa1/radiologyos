"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const money = new Intl.NumberFormat("uk-UA");
const whatsappHref = (message: string) => `https://wa.me/380972808899?text=${encodeURIComponent(message)}`;
const contactMessage = "Добрий день! Хочу обговорити можливості й умови підключення RadiologyOS для свого закладу.";

const features = [
  { icon:"◷", title:"Запис і розклад", text:"Календар заявок і досліджень із прив'язкою до дати, часу та обладнання." },
  { icon:"▤", title:"Картки пацієнтів", text:"Профіль пацієнта, контактні дані, позначки й історія взаємодій." },
  { icon:"◉", title:"Дослідження й протоколи", text:"Черга досліджень, редактор протоколів, підписання та видача результату." },
  { icon:"▧", title:"Вхідні заявки", text:"Реєстратура може переглядати заявки та опрацьовувати їх у робочій черзі." },
  { icon:"☷", title:"Ролі й аудит", text:"Доступ до робочих дій розмежований за ролями; ключові події фіксуються в журналі." },
  { icon:"⌕", title:"Операційні екрани", text:"Черги й реєстри допомагають команді бачити поточний стан роботи." },
];

const audience = [
  { icon:"🏥", tint:"teal", title:"Багатопрофільна клініка", text:"Для команди, якій важливо узгодити прийом, роботу реєстратури та облік досліджень.", points:["Покажемо поточні робочі сценарії","Уточнимо потрібні ролі та процеси","Підтвердимо доступні модулі до домовленості"], cta:"Обговорити для клініки" },
  { icon:"🩻", tint:"blue", title:"Приватний КТ-кабінет", text:"Обговоримо, як RadiologyOS може вписатися у процеси кабінету та роботу з дослідженнями.", points:["Звіримо процес запису й черги","Окремо уточнимо потрібні інтеграції","Підтвердимо доступний функціонал"], cta:"Обговорити для КТ-кабінету" },
  { icon:"🦷", tint:"orange", title:"Приватна практика", text:"Почнемо з ваших поточних процесів і визначимо, які можливості системи підходять для них.", points:["Обговоримо формат роботи","Уточнимо потрібні сценарії","Не обіцяємо функції до їх підтвердження"], cta:"Обговорити для лікаря" },
];

const featureStatus = [
  { name:"DICOM/PACS", note:"внутрішній модуль є; потрібне налаштування PACS" },
  { name:"Звіти Excel", note:"XLSX-експорт є для дозволених ролей персоналу" },
  { name:"Розрахунок зарплати", note:"готовий модуль не підтверджено" },
  { name:"Підтримка 24/7", note:"графік підтримки не підтверджено" },
];

const pricingMessage = "Добрий день! Хочу уточнити, які можливості RadiologyOS доступні зараз і скільки коштуватиме підключення для мого закладу.";

const faq = [
  { q:"Розрахунок утрат — це реальна статистика?", a:"Ні, і ми не видаємо його за неї. Це відкрита формула на розумних припущеннях — кількість записів, частка неявок і середній чек. Підставте свої цифри — логіка залишиться тією ж, а результат стане вашим." },
  { q:"Як дізнатися, який тариф мені підійде?", a:"Напишіть нам у WhatsApp — обговоримо формат роботи вашого закладу, потрібні можливості та умови підключення." },
  { q:"Скільки триває підключення?", a:"Термін і порядок підключення залежать від налаштувань закладу та потрібних модулів. Напишіть нам — уточнимо деталі." },

  { q:"Наскільки захищені дані пацієнтів?", a:"Доступ — лише за ролями й паролями, кожна дія фіксується в журналі. Дані ізольовані по закладу; медичні реєстри зберігаються захищено." },
  { q:"Які модулі доступні зараз?", a:"У внутрішній системі є модуль DICOM/PACS і XLSX-експорт звітів для дозволених ролей персоналу. Підключення PACS для вашого закладу треба налаштувати окремо. Готовий розрахунок зарплати та підтримка 24/7 не підтверджені як доступні послуги." },
  { q:"Чи можна перенести дані з іншої програми?", a:"Імпорт даних не обіцяємо як готову функцію. Перед підключенням окремо перевіримо формат даних і можливість перенесення." },
  { q:"Які канали повідомлень підключені?", a:"Доступність WhatsApp, SMS та інших каналів залежить від поточного стану інтеграцій. Підтвердимо конкретний канал до домовленості." },
  { q:"Як уточнити умови оплати?", a:"Напишіть нам у WhatsApp — уточнимо вартість, спосіб оплати та порядок підключення." },
];

export default function ProductPage() {
  const [visits, setVisits] = useState(400);
  const [noShow, setNoShow] = useState(12);
  const [avg, setAvg] = useState(600);
  const [openFaq, setOpenFaq] = useState(0);

  useEffect(() => { document.title = "RadiologyOS — розумна реєстратура для клінік і лікарів"; }, []);

  const monthlyLoss = Math.round(visits * (noShow / 100) * avg);
  const yearlyLoss = monthlyLoss * 12;

  return <div className="rosLanding">
    <header className="rosHeader">
      <a className="rosBrand" href="#top"><span className="rosBrandMark">✦</span> RadiologyOS</a>
      <nav className="rosNav">
        <a href="#features">Можливості</a>
        <a href="#calc">Розрахунок утрат</a>
        <a href="#audience">Кому підходить</a>
        <a href="#pricing">Тарифи</a>
        <a href="#faq">Питання</a>
      </nav>
      <div className="rosHeaderActions">
        <Link className="rosLogin" href="/staff/login">Увійти</Link>
        <a className="rosBtn" href={whatsappHref(contactMessage)}>Обговорити підключення</a>
      </div>
    </header>

    <section className="rosHero" id="top">
      <span className="rosEyebrow">Розумна реєстратура для клінік і лікарів</span>
      <h1>Обговоріть RadiologyOS<br/><em>для вашого закладу</em></h1>
      <p>Уточніть, які можливості вже доступні для вашого закладу, які модулі можна підключити та якими будуть умови.</p>
      <div className="rosHeroCta">
        <a className="rosBtn rosBtnLg" href={whatsappHref(contactMessage)}>Написати у WhatsApp →</a>
      </div>
      <p className="rosHeroNote">Залишились питання? <a href={whatsappHref(contactMessage)}>Напишіть у WhatsApp</a></p>
    </section>

    <section className="rosIntegr">
      <p className="rosIntegrCap">Статус окремих можливостей</p>
      <div className="rosIntegrChips rosUnavailableList" aria-label="Статус можливостей RadiologyOS">
        {featureStatus.map(item=><span className="rosChip" key={item.name}><b>{item.name}</b> <span>{item.note}</span></span>)}
      </div>
    </section>

    <section className="rosSection" id="features">
      <p className="rosSectionEyebrow">Можливості</p>
      <h2>Єдине ядро для всього закладу</h2>
      <p className="rosLead">Нижче — робочі напрямки системи. Перед підключенням підтвердимо, які з них доступні у вашій конфігурації.</p>
      <div className="rosFeatureGrid">
        {features.map(f=><article className="rosFeature" key={f.title}>
          <span className="rosFeatureIcon" aria-hidden="true">{f.icon}</span>
          <h3>{f.title}</h3><p>{f.text}</p>
        </article>)}
      </div>
    </section>

    <section className="rosSection rosSectionAlt" id="calc">
      <p className="rosSectionEyebrow">Розрахунок утрат</p>
      <h2>Скільки коштують неявки</h2>
      <p className="rosLead">Орієнтовна оцінка за введеними вами цифрами. Це математична модель, а не виміряна статистика чи прогноз ефекту від нагадувань.</p>
      <div className="rosCalc">
        <div className="rosCalcInputs">
          <label><span>Записів на місяць</span><input type="number" min={0} max={100000} value={visits} onChange={e=>setVisits(Math.max(0,Number(e.target.value)||0))}/></label>
          <label><span>Частка неявок, %</span><input type="number" min={0} max={100} value={noShow} onChange={e=>setNoShow(Math.min(100,Math.max(0,Number(e.target.value)||0)))}/></label>
          <label><span>Середній чек, ₴</span><input type="number" min={0} max={1000000} value={avg} onChange={e=>setAvg(Math.max(0,Number(e.target.value)||0))}/></label>
        </div>
        <div className="rosCalcResult">
          <span className="rosCalcResultCap">Орієнтовні втрати</span>
          <b className="rosCalcMonthly">{money.format(monthlyLoss)} ₴<small>/міс</small></b>
          <span className="rosCalcYearly">≈ {money.format(yearlyLoss)} ₴ на рік</span>
          <p>Результат залежить від введених значень і не є обіцянкою економії чи повернення коштів.</p>
        </div>
      </div>
    </section>

    <section className="rosSection" id="audience">
      <p className="rosSectionEyebrow">Кому підходить</p>
      <h2>Клінікам, кабінетам і приватній практиці</h2>
      <p className="rosLead">Система масштабується під розмір бізнесу: від одного кабінету до мережі з десятками лікарів.</p>
      <div className="rosAudienceGrid">
        {audience.map(a=><article className={`rosAudience tint-${a.tint}`} key={a.title}>
          <span className="rosAudienceIcon" aria-hidden="true">{a.icon}</span>
          <h3>{a.title}</h3><p>{a.text}</p>
          <ul>{a.points.map(p=><li key={p}>{p}</li>)}</ul>
          <a className="rosAudienceCta" href={whatsappHref(`Добрий день! Хочу обговорити RadiologyOS для формату «${a.title}».`)}>{a.cta} →</a>
        </article>)}
      </div>
    </section>

    <section className="rosSection rosSectionAlt" id="pricing">
      <p className="rosSectionEyebrow">Тарифи</p>
      <h2>Тарифи та вартість</h2>
      <p className="rosLead">Публічні тарифи й ціни ще не підтверджені для клієнтського підключення. Спочатку узгодимо доступні модулі та процеси, після цього повідомимо вартість.</p>
      <div className="rosPricing rosPricingContact">
        <article className="rosTier rosTierContact">
          <b className="rosTierName">Індивідуальні умови</b>
          <span className="rosTierWho">Після підтвердження доступних функцій</span>
          <p>Запитайте про поточну доступність системи й вартість для вашого закладу.</p>
          <a className="rosBtn rosTierBtn" href={whatsappHref(pricingMessage)}>Уточнити умови й вартість</a>
        </article>
      </div>
      <p className="rosPricingNote">Ціни не публікуємо, доки не підтверджено склад доступної пропозиції.</p>
    </section>

    <section className="rosSection" id="faq">
      <p className="rosSectionEyebrow">Питання</p>
      <h2>Часті питання</h2>
      <div className="rosFaq">
        {faq.map((item,i)=><div className={`rosFaqItem${openFaq===i?" open":""}`} key={i}>
          <button type="button" className="rosFaqQ" aria-expanded={openFaq===i} onClick={()=>setOpenFaq(openFaq===i?-1:i)}>
            <span>{item.q}</span><span className="rosFaqSign" aria-hidden="true">{openFaq===i?"×":"+"}</span>
          </button>
          {openFaq===i && <p className="rosFaqA">{item.a}</p>}
        </div>)}
      </div>
    </section>

    <section className="rosFinalCta">
      <div className="rosFinalCard">
        <h2>Потрібна консультація?</h2>
        <p>Напишіть нам, щоб обговорити можливості RadiologyOS, тарифи та наступні кроки.</p>
        <a className="rosBtn rosBtnOutline" href={whatsappHref(contactMessage)}>Написати у WhatsApp</a>
      </div>
    </section>

    <footer className="rosFooter">
      <div className="rosFooterCols">
        <div className="rosFooterBrand">
          <a className="rosBrand" href="#top"><span className="rosBrandMark">✦</span> RadiologyOS</a>
          <p>Розумна медична система для клінік, кабінетів і приватних лікарів.</p>
        </div>
        <div><b>Продукт</b><a href="#features">Можливості</a><a href="#calc">Розрахунок утрат</a><a href="#pricing">Тарифи</a><a href="#audience">Кому підходить</a></div>
        <div><b>Рішення</b><span>Госпітальна радіологія</span><span>Приватний КТ</span><span>Стоматологія</span><span>Клініка</span></div>
        <div><b>Звʼязатися</b><a href={whatsappHref(contactMessage)}>WhatsApp</a><a href="mailto:hello@radiologyos.tech">hello@radiologyos.tech</a><Link href="/">Сайт госпіталю</Link></div>
      </div>
      <div className="rosFooterBottom"><span>© {new Date().getFullYear()} RadiologyOS</span><span>Єдина кодова база — заклад збирається з налаштувань і модулів.</span></div>
    </footer>
  </div>;
}
