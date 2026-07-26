import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";


const studies = [
  { time: "08:30", patient: "Коваленко Олександр", exam: "КТ головного мозку", room: "КТ №1", status: "Завершено", tone: "done" },
  { time: "09:10", patient: "Мельник Андрій", exam: "КТ ОГК", room: "КТ №1", status: "Описується", tone: "active" },
  { time: "10:00", patient: "Бондаренко Сергій", exam: "КТ ОЧП з контрастом", room: "КТ №1", status: "Очікує", tone: "wait" },
  { time: "10:40", patient: "Шевченко Максим", exam: "Рентген гомілки", room: "Рентген №2", status: "Очікує", tone: "wait" },
  { time: "11:20", patient: "Ткаченко Віталій", exam: "КТ поперекового відділу", room: "КТ №1", status: "Заплановано", tone: "planned" },
];

const nav = [["Огляд", "⌂"], ["Пацієнти", "♙"], ["Дослідження", "▣"], ["Розклад", "□"], ["Протоколи", "≡"], ["Звіти", "↗"]];

const normalDescription = `На серії МСКТ-сканів головного мозку анатомічні утвори серединних структур не зміщені.
Кортико-медулярна диференціація збережена.
Речовина головного мозку в суб- та супратенторіальних відділах без помітних КТ-ознак патологічних змін.
Шлуночки мозку не розширені, без деформації, бокові симетричні.
Конвекситальні підпавутинні простори не деформовані.
Пневматизація комірок соскоподібних відростків та пірамід скроневих кісток не порушена.
Кісткових травматичних або деструктивних змін не виявлено.`;

const phraseBank = [
  { group: "Травма", title: "Ознак внутрішньочерепного крововиливу немає", text: "КТ-ознак гострого внутрішньочерепного крововиливу не виявлено." },
  { group: "Судини", title: "Кальциноз артерій", text: "Відзначаються кальцинати у стінках інтракраніальних відділів внутрішніх сонних артерій." },
  { group: "Атрофія", title: "Помірні атрофічні зміни", text: "Визначається помірне дифузне розширення конвекситальних підпавутинних просторів та шлуночкової системи." },
  { group: "Пазухи", title: "Кіста верхньощелепної пазухи", text: "У верхньощелепній пазусі визначається ретенційна кіста розміром ___ мм." },
];

function App() {
  const [active, setActive] = useState("Огляд");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [description, setDescription] = useState(normalDescription);
  const [conclusion, setConclusion] = useState("МСКТ-ознак органічної патології головного мозку не виявлено.");
  const [patientName, setPatientName] = useState("Мельник Андрій");
  const [urgent, setUrgent] = useState(false);
  const filtered = studies.filter((study) => `${study.patient} ${study.exam}`.toLowerCase().includes(query.toLowerCase()));
  function notify(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function addPhrase(text) {
    setDescription((value) => `${value.trim()}\n${text}`);
    notify("Фразу додано до опису");
  }

  function copyProtocol() {
    const protocol = `ПАЦІЄНТ: ${patientName}\nДОСЛІДЖЕННЯ: КТ головного мозку\n\nОПИС:\n${description}\n\nВИСНОВОК:\n${conclusion}`;
    navigator.clipboard?.writeText(protocol);
    notify("Протокол скопійовано");
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brandMark"><i /><i /><i /></span><span>Radiology<span>OS</span></span></div>
        <nav>
          <p>РОБОЧИЙ ПРОСТІР</p>
          {nav.map(([label, icon]) => (
            <button className={active === label ? "active" : ""} key={label} onClick={() => { setActive(label); if (!["Огляд", "Протоколи"].includes(label)) notify(`${label}: модуль наступного етапу`); }}>
              <b>{icon}</b>{label}
            </button>
          ))}
        </nav>
        <div className="department"><span>ВІДДІЛЕННЯ</span><strong>Променева діагностика</strong><small>Чернігівський військовий госпіталь</small></div>
        <button className="profile" onClick={() => notify("Профіль користувача")}><span>ДА</span><span><strong>Дмитро Адаменко</strong><small>Керівник відділення</small></span><b>•••</b></button>
      </aside>

      <section className="workspace">
        <header>
          <button className="mobileBrand" onClick={() => notify("RadiologyOS")}>R<span>OS</span></button>
          <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Пошук пацієнта або дослідження..." /><kbd>⌘ K</kbd></label>
          <div className="headerActions"><button onClick={() => notify("Нових сповіщень немає")}>♢<i /></button><button className="primary" onClick={() => notify("Форма нового дослідження буде підключена на наступному етапі")}>＋ Нове дослідження</button></div>
        </header>

        {active === "Протоколи" ? (
          <div className="content reportContent">
            <div className="reportTop">
              <div><p className="eyebrow">КТ • ГОЛОВНИЙ МОЗОК</p><h1>Конструктор протоколу</h1><span>Шаблон: КТ ГМ — Норма</span></div>
              <div className="reportActions"><button onClick={() => { setDescription(normalDescription); setConclusion("МСКТ-ознак органічної патології головного мозку не виявлено."); notify("Шаблон відновлено"); }}>Скинути</button><button className="saveDraft" onClick={() => notify("Чернетку збережено")}>Зберегти чернетку</button><button className="copy" onClick={copyProtocol}>Копіювати протокол</button></div>
            </div>

            <section className="patientStrip">
              <label><span>ПАЦІЄНТ</span><input value={patientName} onChange={(e) => setPatientName(e.target.value)} /></label>
              <label><span>ДАТА НАРОДЖЕННЯ</span><input defaultValue="14.02.1986" /></label>
              <label><span>ДАТА ДОСЛІДЖЕННЯ</span><input defaultValue="26.07.2026" /></label>
              <label><span>НАПРАВИВ</span><input defaultValue="Неврологічне відділення" /></label>
            </section>

            <div className="builderGrid">
              <aside className="phrasePanel panel">
                <div className="panelTitle"><div><h2>Банк фраз</h2><p>Натисніть, щоб додати до опису</p></div></div>
                <div className="phraseSearch">⌕ <input placeholder="Пошук фрази..." /></div>
                <div className="phrases">{phraseBank.map((phrase) => <button key={phrase.title} onClick={() => addPhrase(phrase.text)}><small>{phrase.group}</small><strong>{phrase.title}</strong><span>＋</span></button>)}</div>
              </aside>

              <section className="editorStack">
                <article className="editorCard panel">
                  <div className="editorHead"><div><span>1</span><div><h2>Опис дослідження</h2><p>Відредагуйте шаблон відповідно до КТ-картини</p></div></div><b>{description.length} знаків</b></div>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
                </article>
                <article className="editorCard conclusionCard panel">
                  <div className="editorHead"><div><span>2</span><div><h2>Висновок</h2><p>Короткий клінічно значущий підсумок</p></div></div></div>
                  <textarea value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
                </article>
              </section>

              <aside className="checks">
                <section className={`redFlags panel ${urgent ? "flagActive" : ""}`}>
                  <div className="panelTitle"><div><h2>Червоні прапорці</h2><p>Потребують негайного повідомлення</p></div><span>!</span></div>
                  {["Гострий внутрішньочерепний крововилив", "Компресія базальних цистерн / дислокація", "Ознаки оклюзії великої судини", "Напружена пневмоцефалія"].map((flag) => <label key={flag}><input type="checkbox" onChange={(e) => setUrgent(e.currentTarget.checked || urgent)} /> <span>{flag}</span></label>)}
                  <div className="flagStatus">{urgent ? "Критичну знахідку необхідно повідомити усно та задокументувати." : "Критичних знахідок не позначено"}</div>
                </section>
                <section className="quality panel">
                  <div className="panelTitle"><div><h2>Контроль якості</h2><p>Перед завершенням</p></div></div>
                  <p><i>✓</i> Опис заповнений</p><p><i>✓</i> Висновок заповнений</p><p><i>✓</i> Дані пацієнта вказані</p>
                  <button onClick={() => notify(urgent ? "Перевірте повідомлення про критичну знахідку" : "Протокол завершено")}>Завершити протокол</button>
                </section>
              </aside>
            </div>
          </div>
        ) : (
        <div className="content">
          <div className="welcome">
            <div><p>НЕДІЛЯ, 26 ЛИПНЯ</p><h1>Добрий вечір, Дмитре</h1><span>Ось актуальна ситуація у відділенні на сьогодні.</span></div>
            <div className="shift"><i /> Зміна активна <b>07:00 — 19:00</b></div>
          </div>

          <section className="metrics">
            <article><span className="metricIcon blue">▣</span><div><small>ДОСЛІДЖЕНЬ СЬОГОДНІ</small><strong>18</strong><p><em>↑ 12%</em> від учора</p></div></article>
            <article><span className="metricIcon amber">◷</span><div><small>ОЧІКУЮТЬ ОПИСУ</small><strong>5</strong><p>2 термінових</p></div></article>
            <article><span className="metricIcon green">✓</span><div><small>ЗАВЕРШЕНО</small><strong>11</strong><p>61% від плану</p></div></article>
            <article><span className="metricIcon violet">♙</span><div><small>ПАЦІЄНТІВ</small><strong>16</strong><p>3 нових</p></div></article>
          </section>

          <div className="mainGrid">
            <section className="panel schedule">
              <div className="panelTitle"><div><h2>Розклад на сьогодні</h2><p>Найближчі дослідження та їх статус</p></div><button onClick={() => notify("Відкрито повний розклад")}>Весь розклад →</button></div>
              <div className="tableHead"><span>ЧАС</span><span>ПАЦІЄНТ</span><span>ДОСЛІДЖЕННЯ</span><span>КАБІНЕТ</span><span>СТАТУС</span></div>
              {filtered.map((study) => (
                <button className="studyRow" key={`${study.time}-${study.patient}`} onClick={() => notify(`${study.patient}: ${study.exam}`)}>
                  <strong>{study.time}</strong><span className="patient"><i>{study.patient.split(" ").map(x => x[0]).join("").slice(0, 2)}</i>{study.patient}</span><span>{study.exam}</span><span>{study.room}</span><em className={study.tone}>{study.status}</em>
                </button>
              ))}
              {!filtered.length && <div className="empty">За вашим запитом нічого не знайдено.</div>}
            </section>

            <aside className="sideColumn">
              <section className="panel workload">
                <div className="panelTitle"><div><h2>Навантаження</h2><p>За типом досліджень</p></div><button>•••</button></div>
                <div className="donut"><div><strong>18</strong><small>усього</small></div></div>
                <div className="legend"><p><i className="ct" />КТ <span>12 <small>67%</small></span></p><p><i className="xray" />Рентген <span>4 <small>22%</small></span></p><p><i className="fluoro" />Рентгеноскопія <span>2 <small>11%</small></span></p></div>
              </section>
              <section className="panel quick">
                <div className="panelTitle"><div><h2>Швидкі дії</h2><p>Часті операції</p></div></div>
                <div><button onClick={() => notify("Новий пацієнт")}><span>＋</span>Новий пацієнт</button><button onClick={() => notify("Конструктор протоколу")}><span>▤</span>Створити протокол</button><button onClick={() => notify("Звіт за зміну")}><span>↗</span>Звіт за зміну</button></div>
              </section>
            </aside>
          </div>
        </div>
        )}
      </section>
      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
