"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const money = new Intl.NumberFormat("uk-UA");

const features = [
  { icon:"◷", title:"Онлайн-запис і розклад", text:"Запис із сайту, бота й реєстратури в один календар — по днях, кабінетах і апаратах." },
  { icon:"▤", title:"Медкартки й протоколи", text:"Історія візитів, конструктор протоколів дослідження з шаблонами й нормами." },
  { icon:"◔", title:"Нагадування пацієнтам", text:"WhatsApp, SMS і Telegram про підтвердження та перенесення — без ручних дзвінків." },
  { icon:"₴", title:"Каса, оплати та звірка", text:"Статуси оплат, каса й зміни, звірка з банком, рахунки й квитанції." },
  { icon:"▦", title:"Знімки DICOM / PACS", text:"Прив'язка досліджень до знімків, перегляд у вебглядачі, обмін із лікарями." },
  { icon:"▥", title:"Аналітика й звіти", text:"Виручка, завантаженість апаратів і лікарів, експорт у Excel одним кліком." },
  { icon:"◉", title:"Ролі, права та аудит", text:"Адмін, реєстратор, лікар, лаборант. Журнал дій і захист медичних даних." },
  { icon:"◑", title:"Свій бренд і домен", text:"Назва, логотип, кольори й домен вашого закладу — сайт і кабінет у вашому стилі." },
];

const audience = [
  { icon:"🏥", tint:"teal", title:"Багатопрофільна клініка", text:"Кілька лікарів і реєстратура, що веде телефон, живу чергу й касу. RadiologyOS знімає рутину, а керівнику дає прозорі показники по кожному лікарю.", points:["Розклад і запис для всієї команди","Ролі: адміністратор, лікар, реєстратор","Зарплата лікарів за відсотком — без Excel","Аналітика по клініці й по кожному лікарю"], cta:"Почати як клініка" },
  { icon:"🩻", tint:"blue", title:"Приватний КТ-кабінет", text:"Один-два апарати й потік досліджень. Онлайн-запис, слоти з реального розкладу апарата, протоколи й знімки — усе в одному місці.", points:["Запис за вільними слотами апарата","Протоколи КТ з шаблонами","Знімки DICOM під рукою","Каса й звіти по виручці"], cta:"Почати як кабінет" },
  { icon:"🦷", tint:"orange", title:"Стоматологія та інші", text:"Панорамна рентгенографія й прийом без окремого адміністратора. Запис, нагадування й картки працюють самі, поки ви зайняті пацієнтом.", points:["Особистий кабінет і свій розклад","Сторінка запису зі своїм посиланням","Картка пацієнта завжди під рукою","WhatsApp-нагадування замість дзвінків"], cta:"Почати як лікар" },
];

const integrations = [
  { name:"Приват24", note:"· приймання оплат" },
  { name:"WhatsApp", note:"· нагадування й запис через бота" },
  { name:"Telegram", note:"· сповіщення реєстратурі" },
  { name:"Google Календар", note:"· синхронізація розкладу" },
];

const tiers = [
  { name:"Базовий", who:"Для приватного прийому", price:"990", unit:"₴/міс", seats:"1 лікар", points:["Онлайн-запис пацієнтів","WhatsApp-нагадування","Картки пацієнтів"] },
  { name:"Старт", who:"Для невеликої клініки", price:"2 490", unit:"₴/міс", seats:"до 5 лікарів", points:["Усе з Базового","Шаблони протоколів","Зарплата лікарів","Підтримка 24/7"] },
  { name:"Про", who:"Для клініки, що росте", price:"4 990", unit:"₴/міс", seats:"до 15 лікарів", popular:true, points:["Усе зі Старту","Каса й рахунки","Аналітика по клініці","Пріоритетна підтримка"] },
  { name:"Про+", who:"Клініка зі своїм сайтом", price:"7 990", unit:"₴/міс", seats:"до 25 лікарів", points:["Усе з Про","Сайт клініки на домені","5 тем оформлення","Онлайн-запис із сайту"] },
  { name:"Мережа", who:"Для мережі чи центру", price:"14 990", unit:"₴/міс", seats:"без обмежень", points:["Усе з Про+","Безліміт лікарів","Свій номер WhatsApp","Персональний менеджер"] },
];

const faq = [
  { q:"Розрахунок утрат — це реальна статистика?", a:"Ні, і ми не видаємо його за неї. Це відкрита формула на розумних припущеннях — кількість записів, частка неявок і середній чек. Підставте свої цифри — логіка залишиться тією ж, а результат стане вашим." },
  { q:"Чи потрібна картка, щоб спробувати безкоштовно?", a:"Ні. 14 днів безкоштовно, усі функції включені, картка не потрібна. Наприкінці пробного періоду ви оберете тариф — дані й налаштування залишаться на місці." },
  { q:"Скільки триває впровадження?", a:"Реєстрація займає близько 5 хвилин. Онлайн-запис, нагадування й картки працюють того ж дня. Перенесення послуг, апаратів і графіків налаштовується за пару годин." },
  { q:"Наскільки захищені дані пацієнтів?", a:"Доступ — лише за ролями й паролями, кожна дія фіксується в журналі. Дані ізольовані по закладу; медичні реєстри зберігаються захищено." },
  { q:"Чи можна перенести пацієнтів з Excel або іншої програми?", a:"Так. Ми допоможемо імпортувати пацієнтів, послуги й ціни зі звичайних таблиць — переносити вручну не доведеться." },
  { q:"WhatsApp і SMS запрацюють одразу?", a:"Так, після підключення вашого шлюзу в налаштуваннях. До того нагадування ставляться в чергу й нічого не блокують." },
  { q:"Як скасувати підписку, якщо не підійде?", a:"У будь-який момент, в один клік у налаштуваннях. Оплата за рік — зі знижкою 15%; за місяць — без зобов'язань." },
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
        <a className="rosBtn" href="#pricing">Почати безкоштовно</a>
      </div>
    </header>

    <section className="rosHero" id="top">
      <span className="rosEyebrow">Розумна реєстратура для клінік і лікарів</span>
      <h1>Почніть з безкоштовного періоду<br/><em>— без картки й зобовʼязань</em></h1>
      <p>Реєстрація займає 5 хвилин. Онлайн-запис, нагадування та медкартки запрацюють того ж дня — переносити дані вручну не доведеться.</p>
      <div className="rosHeroCta">
        <a className="rosBtn rosBtnLg" href="#pricing">Почати безкоштовно →</a>
      </div>
      <p className="rosHeroNote">Залишились питання? <a href="https://wa.me/380972808899">Напишіть у WhatsApp</a></p>
    </section>

    <section className="rosIntegr">
      <p className="rosIntegrCap">Працює через сервіси, якими ваші пацієнти користуються щодня</p>
      <div className="rosIntegrChips">
        {integrations.map(i=><span className="rosChip" key={i.name}><b>{i.name}</b> <span>{i.note}</span></span>)}
      </div>
    </section>

    <section className="rosSection" id="features">
      <p className="rosSectionEyebrow">Можливості</p>
      <h2>Єдине ядро для всього закладу</h2>
      <p className="rosLead">Пацієнти, запис, дослідження, оплати й аналітика — в одній системі. Організація збирається з налаштувань і модулів.</p>
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
      <p className="rosLead">Відкрита формула на ваших цифрах. Порахуйте, скільки втрачає заклад на неявках — і скільки з цього повертають нагадування.</p>
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
          <p>Місяць роботи на тарифі «Старт» дешевший за один день неявок із розрахунку вище.</p>
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
          <a className="rosAudienceCta" href="#pricing">{a.cta} →</a>
        </article>)}
      </div>
    </section>

    <section className="rosSection rosSectionAlt" id="pricing">
      <p className="rosSectionEyebrow">Тарифи</p>
      <h2>Тарифи та вартість</h2>
      <p className="rosLead">Вартість залежить лише від числа лікарів — платити за невикористані місця не потрібно.</p>
      <div className="rosPricing">
        {tiers.map(t=><article className={`rosTier${t.popular?" popular":""}`} key={t.name}>
          {t.popular && <span className="rosTierBadge">Популярний</span>}
          <b className="rosTierName">{t.name}</b>
          <span className="rosTierWho">{t.who}</span>
          <div className="rosTierPrice"><b>{t.price}</b> <span>{t.unit}</span></div>
          <span className="rosTierSeats">{t.seats}</span>
          <ul>{t.points.map(p=><li key={p}>{p}</li>)}</ul>
          <a className="rosBtn rosTierBtn" href="#top">Обрати</a>
        </article>)}
      </div>
      <p className="rosPricingNote">Обрали тариф — оплата одразу після реєстрації · Оплата за рік — знижка 15% · Скасування будь-коли</p>
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
        <h2>Хочете спочатку подивитися?</h2>
        <p>14 днів безкоштовно, усі функції включені, картка не потрібна. Наприкінці пробного періоду оберете тариф — дані й налаштування залишаться на місці.</p>
        <a className="rosBtn rosBtnOutline" href="#pricing">Спробувати безкоштовно 14 днів</a>
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
        <div><b>Звʼязатися</b><a href="https://wa.me/380972808899">WhatsApp</a><a href="mailto:hello@radiologyos.tech">hello@radiologyos.tech</a><Link href="/">Сайт госпіталю</Link></div>
      </div>
      <div className="rosFooterBottom"><span>© {new Date().getFullYear()} RadiologyOS</span><span>Єдина кодова база — заклад збирається з налаштувань і модулів.</span></div>
    </footer>
  </div>;
}
