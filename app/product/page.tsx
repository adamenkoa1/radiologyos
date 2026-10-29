"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const money = new Intl.NumberFormat("uk-UA");
const whatsappHref = (message: string) => `https://wa.me/380972808899?text=${encodeURIComponent(message)}`;
const contactMessage = "Добрий день! Хочу обговорити роботу RadiologyOS для відділення діагностики та доступні зараз можливості.";

const proofItems = [
  "Заявка й картка пацієнта",
  "Черга досліджень",
  "Протокол: чернетка → підпис → видача",
  "Рольовий доступ і журнал подій",
];

const processSteps = [
  { number:"01", title:"Заявка", text:"Плановий запис або walk-in потрапляє в робочу систему." },
  { number:"02", title:"Пацієнт", text:"Заявка пов’язується з карткою пацієнта без тихого злиття дублікатів." },
  { number:"03", title:"Дослідження", text:"Реєстратура бачить стан, обладнання та призначення." },
  { number:"04", title:"Протокол", text:"Лікар готує опис, підписує його й передає на видачу." },
  { number:"05", title:"Результат", text:"Видача фіксується в життєвому циклі документа та аудиті." },
];

const roleCards = [
  { title:"Реєстратура", text:"Опрацьовує заявки, картки пацієнтів і запис відповідно до своїх прав." },
  { title:"Лікар-рентгенолог", text:"Працює з призначеними дослідженнями, створює та підписує протоколи." },
  { title:"Адміністратор", text:"Керує налаштуваннями й доступами у межах ролі закладу." },
];

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
        <a href="#features">Можливості</a>\n        <a href="#flow">Як працює</a>
        <a href="#calc">Розрахунок утрат</a>
        <a href="#audience">Для кого</a>
        <a href="#pricing">Тарифи</a>
        <a href="#faq">Питання</a>
      </nav>
      <div className="rosHeaderActions">
        <Link className="rosLogin" href="/staff/login">Увійти</Link>
        <a className="rosBtn" href={whatsappHref(contactMessage)}>Обговорити підключення</a>
      </div>
    </header>

    <section className="rosHero" id="top">
      <div className="rosHeroCopy">
        <span className="rosEyebrow">Робочий простір радіологічного відділення</span>
        <h1>Від заявки до виданого протоколу<br/><em>в одному радіологічному процесі</em></h1>
        <p>Заявки, картки пацієнтів, дослідження та протоколи — в узгодженій робочій черзі. Перед підключенням підтвердимо доступний для вашого закладу склад.</p>
        <div className="rosHeroCta">
          <a className="rosBtn rosBtnLg" href={whatsappHref(contactMessage)}>Обговорити систему →</a>
        </div>
        <p className="rosHeroNote">Спершу звіримо ваш процес, потрібні модулі та умови.</p>
      </div>
      <div className="rosHeroPreview" aria-label="Схема робочої черги, демонстраційні дані">
        <div className="rosPreviewTop"><span>RadiologyOS</span><span>Схема робочого процесу</span></div>
        <div className="rosPreviewTitle"><b>Дослідження</b><span>Стан черги</span></div>
        <div className="rosPreviewRows">
          <div><i className="rosDot pending"/>Очікує опису<span>Черга</span></div>
          <div><i className="rosDot ready"/>До підпису<span>Перевірка</span></div>
          <div><i className="rosDot issued"/>Видано<span>Завершено</span></div>
        </div>
        <div className="rosPreviewFoot">Схематичний інтерфейс · без даних пацієнтів</div>
      </div>
    </section>

    <section className="rosIntegr" aria-label="Основні частини робочого процесу">
      <p className="rosIntegrCap">Один маршрут дослідження</p>
      <div className="rosIntegrChips rosProofStrip">
        {proofItems.map(item=><span className="rosChip" key={item}>{item}</span>)}
      </div>
    </section>

    <section className="rosSection rosComparisonSection" id="compare">
      <p className="rosSectionEyebrow">Один контур роботи</p>
      <h2>Від розрізнених кроків — до видимого процесу</h2>
      <p className="rosLead">RadiologyOS з’єднує запис, дослідження та протокол. Фактичний склад вашої конфігурації уточнимо перед підключенням.</p>
      <div className="rosComparisonWrap">
        <table className="rosComparison">
          <thead><tr><th>Етап</th><th>Коли дані розділені</th><th>У робочому контурі RadiologyOS</th></tr></thead>
          <tbody>
            <tr><th>Пацієнт і заявка</th><td>Потрібно окремо звіряти картку й запис.</td><td>Картка пов’язана із заявкою та дослідженням.</td></tr>
            <tr><th>Черга досліджень</th><td>Стан уточнюють між кабінетом і реєстратурою.</td><td>Стан і призначення видно в реєстрі.</td></tr>
            <tr><th>Опис і видача</th><td>Результат може бути окремо від робочої черги.</td><td>Протокол проходить чернетку, підписання та видачу.</td></tr>
            <tr><th>Доступ</th><td>Права доводиться узгоджувати вручну.</td><td>Серверні дії перевіряють роль та організацію.</td></tr>
          </tbody>
        </table>
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

    <section className="rosSection rosProcessSection" id="flow">
      <p className="rosSectionEyebrow">Як працює</p>
      <h2>Шлях пацієнта — від заявки до результату</h2>
      <p className="rosLead">П’ять кроків клінічного процесу в системі. Медичне рішення й текст висновку лишаються за лікарем.</p>
      <ol className="rosProcess">
        {processSteps.map(step=><li key={step.number}>
          <span className="rosProcessNumber">{step.number}</span>
          <div><h3>{step.title}</h3><p>{step.text}</p></div>
        </li>)}
      </ol>
    </section>

    <section className="rosSection rosRolesSection" id="roles">
      <p className="rosSectionEyebrow">Командна робота</p>
      <h2>Кожній ролі — своя робоча зона</h2>
      <p className="rosLead">Сервер перевіряє роль і доступ до закладу на кожній захищеній дії.</p>
      <div className="rosRoleGrid">
        {roleCards.map(role=><article className="rosRoleCard" key={role.title}><h3>{role.title}</h3><p>{role.text}</p></article>)}
      </div>
    </section>

    <section className="rosSection" id="features">
      <p className="rosSectionEyebrow">Операційна система відділення</p>
      <h2>Кожен етап дослідження видно команді</h2>
      <p className="rosLead">Від реєстрації пацієнта до видачі результату команда працює в спільній черзі. Доступні модулі та налаштування погоджуємо окремо.</p>
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

    <section className="rosSection rosSectionAlt rosStatusSection" id="availability">
      <p className="rosSectionEyebrow">Доступність модулів</p>
      <h2>Що підтверджено зараз</h2>
      <p className="rosLead">Розділяємо функції у внутрішній системі та послуги, доступність яких для клієнтського середовища ще треба погодити.</p>
      <div className="rosStatusGrid">
        {featureStatus.map(item=><article className="rosStatusCard" key={item.name}><b>{item.name}</b><p>{item.note}</p></article>)}
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
