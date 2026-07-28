import Link from "next/link";

export default function Home() {
  return (
    <main className="publicShell">
      <div className="landing" id="top">
        <div className="landingCard landingHeader">
          <div className="landingHeaderTop">
            <div className="landingHeaderTitle">
              <b>Чернігівський військовий госпіталь</b>
              <small>Відділення променевої діагностики</small>
            </div>
            <details className="landingLogin">
              <summary>Вхід</summary>
              <div>
                <a href="/cabinet">Статус заявки</a>
                <a href="/staff/login">Кабінет персоналу</a>
              </div>
            </details>
          </div>
          <ul className="modalityChips" aria-label="Дослідження відділення">
            <li><span aria-hidden="true">ФЛГ</span>Флюорографія</li>
            <li><span aria-hidden="true">РГ</span>Рентгенографія</li>
            <li><span aria-hidden="true">КТ</span>Комп’ютерна томографія</li>
          </ul>
        </div>

        <Link className="landingCard categoryCard military" href="/booking?category=military">
          <span className="categoryIcon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5l8-3z"/></svg></span>
          <span className="categoryCopy"><b>Військовослужбовцям</b><small>Безоплатні дослідження за направленням</small></span>
          <span className="categoryChevron" aria-hidden="true">›</span>
        </Link>

        <Link className="landingCard categoryCard civilian" href="/booking?category=civilian">
          <span className="categoryIcon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/></svg></span>
          <span className="categoryCopy"><b>Цивільним особам</b><small>Платні дослідження — повний прайс і запис</small></span>
          <span className="categoryChevron" aria-hidden="true">›</span>
        </Link>

        <a className="landingCard infoCard" href="tel:+380972808899">
          <span className="infoText"><b>Телефон</b><span>+380 97 280 88 99</span></span>
          <span className="categoryChevron" aria-hidden="true">›</span>
        </a>
        <a className="landingCard infoCard" href="https://maps.google.com/?q=Чернігів,+вул.+Полуботка,+40" target="_blank" rel="noopener noreferrer">
          <span className="infoText"><b>Адреса</b><span>м. Чернігів, вул. Полуботка, 40</span></span>
          <span className="categoryChevron" aria-hidden="true">›</span>
        </a>

        <footer className="landingFoot">
          <span>Пн–Сб · 08:00–17:00</span>
          <span>Онлайн-запис не призначений для невідкладних станів.</span>
        </footer>
      </div>
    </main>
  );
}
