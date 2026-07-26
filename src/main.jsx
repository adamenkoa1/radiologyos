import React, { useEffect, useMemo, useState } from "react";
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

const scenarios = [
  { id: "normal", label: "Норма", icon: "✓", conclusion: "МСКТ-ознак органічної патології головного мозку не виявлено.", extra: "" },
  { id: "trauma", label: "Травма", icon: "✦", conclusion: "КТ-ознаки травматичних змін головного мозку та кісток черепа потребують уточнення за описом.", extra: "КТ-ознак гострого внутрішньочерепного крововиливу не виявлено. Кісткових травматичних змін не виявлено." },
  { id: "stroke", label: "Інсульт", icon: "≈", conclusion: "Переконливих КТ-ознак гострого порушення мозкового кровообігу на момент дослідження не виявлено.", extra: "Зон патологічно зниженої щільності, втрати кортико-медулярної диференціації або гіперденсних артерій не виявлено." },
  { id: "atrophy", label: "Атрофія", icon: "◉", conclusion: "КТ-ознаки помірних дифузних атрофічних змін головного мозку.", extra: "Визначається помірне дифузне розширення конвекситальних підпавутинних просторів та шлуночкової системи." },
  { id: "hemorrhage", label: "Крововилив", icon: "!", conclusion: "КТ-ознаки гострого внутрішньочерепного крововиливу. Потребує негайного клінічного повідомлення.", extra: "Визначається гіперденсна ділянка гострого крововиливу: локалізація ___, розміри ___ мм, щільність ___ HU, перифокальний набряк ___, мас-ефект ___." },
  { id: "hydro", label: "Гідроцефалія", icon: "◇", conclusion: "КТ-ознаки розширення шлуночкової системи головного мозку.", extra: "Шлуночкова система розширена: індекс Еванса ___, перивентрикулярний набряк ___, ознаки оклюзії лікворних шляхів ___." },
];

const anatomyBlocks = [
  { id: "method", label: "Методика", options: ["Стандартне нативне дослідження", "Дослідження з контрастуванням"] },
  { id: "parenchyma", label: "Речовина мозку", options: ["Без вогнищевих змін", "Атрофічні зміни", "Вогнищеві зміни — уточнити"] },
  { id: "ventricles", label: "Шлуночкова система", options: ["Не розширена", "Помірно розширена", "Асиметрична"] },
  { id: "midline", label: "Серединні структури", options: ["Не зміщені", "Зміщення — вказати напрямок і мм"] },
  { id: "csf", label: "Лікворні простори", options: ["Не розширені", "Помірно розширені", "Локально деформовані"] },
  { id: "brainstem", label: "Мозочок і стовбур", options: ["Без помітних змін", "Зміни — уточнити"] },
  { id: "skull", label: "Кістки черепа", options: ["Без травматичних змін", "Перелом — уточнити локалізацію"] },
  { id: "sinuses", label: "Пазухи та соскоподібні клітини", options: ["Пневматизація не порушена", "Запальні зміни", "Ретенційна кіста"] },
  { id: "orbits", label: "Орбіти і м’які тканини", options: ["Без помітних змін", "Зміни — уточнити"] },
];

function App() {
  const [active, setActive] = useState("Огляд");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [description, setDescription] = useState(normalDescription);
  const [conclusion, setConclusion] = useState("МСКТ-ознак органічної патології головного мозку не виявлено.");
  const [patientName, setPatientName] = useState("Мельник Андрій");
  const [urgent, setUrgent] = useState(false);
  const [scenario, setScenario] = useState("normal");
  const [phraseQuery, setPhraseQuery] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);
  const [builderMode, setBuilderMode] = useState("quick");
  const [blockValues, setBlockValues] = useState(() => Object.fromEntries(anatomyBlocks.map((block) => [block.id, block.options[0]])));
  const [showPreview, setShowPreview] = useState(false);
  const [history, setHistory] = useState([]);
  const visiblePhrases = useMemo(() => phraseBank.filter((phrase) => `${phrase.group} ${phrase.title} ${phrase.text}`.toLowerCase().includes(phraseQuery.toLowerCase())), [phraseQuery]);
  const filtered = studies.filter((study) => `${study.patient} ${study.exam}`.toLowerCase().includes(query.toLowerCase()));
  const reviewItems = useMemo(() => {
    const items = [];
    if (!description.trim()) items.push({ tone: "warn", text: "Опис дослідження не заповнений" });
    if (!conclusion.trim()) items.push({ tone: "warn", text: "Висновок не заповнений" });
    if (description.includes("___") || conclusion.includes("___")) items.push({ tone: "warn", text: "Залишилися незаповнені поля ___" });
    if (scenario === "hemorrhage" && conclusion.toLowerCase().includes("не виявлено")) items.push({ tone: "error", text: "Суперечність: сценарій крововиливу та негативний висновок" });
    if (urgent && !conclusion.toLowerCase().includes("гостр")) items.push({ tone: "error", text: "Критична знахідка не відображена у висновку" });
    if (!items.length) items.push({ tone: "ok", text: "Структура протоколу заповнена, суперечностей не знайдено" });
    return items;
  }, [description, conclusion, scenario, urgent]);

  useEffect(() => {
    const saved = window.localStorage.getItem("radiologyos-ct-brain-draft");
    if (!saved) return;
    try {
      const draft = JSON.parse(saved);
      setDescription(draft.description || normalDescription);
      setConclusion(draft.conclusion || "");
      setPatientName(draft.patientName || "");
      setScenario(draft.scenario || "normal");
      setDraftRestored(true);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      setHistory(JSON.parse(window.localStorage.getItem("radiologyos-protocol-history") || "[]"));
    } catch {}
  }, []);
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

  function applyScenario(id) {
    const selected = scenarios.find((item) => item.id === id);
    if (!selected) return;
    setScenario(id);
    setDescription(selected.extra ? `${normalDescription}\n${selected.extra}` : normalDescription);
    setConclusion(selected.conclusion);
    setUrgent(id === "hemorrhage");
    notify(`Сценарій «${selected.label}» застосовано`);
  }

  function saveDraft() {
    window.localStorage.setItem("radiologyos-ct-brain-draft", JSON.stringify({ patientName, description, conclusion, scenario }));
    setDraftRestored(true);
    notify("Чернетку збережено на цьому пристрої");
  }

  function updateBlock(id, value) {
    const next = { ...blockValues, [id]: value };
    setBlockValues(next);
    const generated = anatomyBlocks.map((block) => `${block.label}: ${next[block.id]}.`).join("\n");
    setDescription(generated);
  }

  function finalizeProtocol() {
    if (reviewItems.some((item) => item.tone === "error")) {
      notify("Спочатку усуньте суперечності");
      return;
    }
    const record = { id: crypto.randomUUID(), patient: patientName, date: "26.07.2026", status: "Підписано", conclusion };
    const next = [record, ...history].slice(0, 5);
    setHistory(next);
    window.localStorage.setItem("radiologyos-protocol-history", JSON.stringify(next));
    window.localStorage.removeItem("radiologyos-ct-brain-draft");
    setDraftRestored(false);
    setShowPreview(true);
    notify("Протокол підписано та збережено");
  }

  function downloadProtocol() {
    const html = `<!doctype html><html><meta charset="utf-8"><body><h2>КТ головного мозку</h2><p><b>Пацієнт:</b> ${patientName}</p><p><b>Дата:</b> 26.07.2026</p><h3>Опис</h3><p>${description.replace(/\n/g, "<br>")}</p><h3>Висновок</h3><p><b>${conclusion}</b></p><p>Лікар-рентгенолог: Дмитро Адаменко</p></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "application/msword;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `КТ_ГМ_${patientName.replace(/\s+/g, "_")}.doc`;
    link.click();
    URL.revokeObjectURL(url);
    notify("Документ підготовлено");
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
              <div className="reportActions"><button onClick={() => applyScenario("normal")}>Норма</button><button className="saveDraft" onClick={saveDraft}>Зберегти чернетку</button><button className="copy" onClick={copyProtocol}>Копіювати протокол</button></div>
            </div>

            <div className="modeSwitch">
              <button className={builderMode === "quick" ? "selected" : ""} onClick={() => setBuilderMode("quick")}><span>1</span><div><strong>Швидкий шаблон</strong><small>Готовий сценарій та банк фраз</small></div></button>
              <button className={builderMode === "anatomy" ? "selected" : ""} onClick={() => setBuilderMode("anatomy")}><span>2</span><div><strong>Анатомічні блоки</strong><small>Послідовна перевірка всіх структур</small></div></button>
            </div>

            {draftRestored && <div className="draftBanner"><span>✓</span> Чернетку збережено на цьому пристрої <button onClick={() => { window.localStorage.removeItem("radiologyos-ct-brain-draft"); setDraftRestored(false); notify("Збережену чернетку видалено"); }}>Очистити</button></div>}

            <section className="patientStrip">
              <label><span>ПАЦІЄНТ</span><input value={patientName} onChange={(e) => setPatientName(e.target.value)} /></label>
              <label><span>ДАТА НАРОДЖЕННЯ</span><input defaultValue="14.02.1986" /></label>
              <label><span>ДАТА ДОСЛІДЖЕННЯ</span><input defaultValue="26.07.2026" /></label>
              <label><span>НАПРАВИВ</span><input defaultValue="Неврологічне відділення" /></label>
            </section>

            {builderMode === "quick" ? <section className="scenarioBar panel">
              <div><strong>Швидкий сценарій</strong><span>Оберіть основу протоколу</span></div>
              <div className="scenarioButtons">{scenarios.map((item) => <button className={scenario === item.id ? "selected" : ""} key={item.id} onClick={() => applyScenario(item.id)}><i>{item.icon}</i>{item.label}</button>)}</div>
            </section> : <section className="anatomyBuilder panel">
              <div className="panelTitle"><div><h2>Складання опису по анатомічних блоках</h2><p>{anatomyBlocks.length} розділів • зміни одразу формують текст опису</p></div><span>{Object.values(blockValues).filter(Boolean).length}/{anatomyBlocks.length}</span></div>
              <div className="anatomyGrid">{anatomyBlocks.map((block, index) => <label key={block.id}><span><b>{index + 1}</b>{block.label}</span><select value={blockValues[block.id]} onChange={(e) => updateBlock(block.id, e.target.value)}>{block.options.map((option) => <option key={option}>{option}</option>)}</select></label>)}</div>
            </section>}

            <div className="builderGrid">
              <aside className={`phrasePanel panel ${builderMode === "anatomy" ? "compactPhrase" : ""}`}>
                <div className="panelTitle"><div><h2>Банк фраз</h2><p>Натисніть, щоб додати до опису</p></div></div>
                <div className="phraseSearch">⌕ <input value={phraseQuery} onChange={(e) => setPhraseQuery(e.target.value)} placeholder="Пошук фрази..." /></div>
                <div className="phrases">{visiblePhrases.map((phrase) => <button key={phrase.title} onClick={() => addPhrase(phrase.text)}><small>{phrase.group}</small><strong>{phrase.title}</strong><span>＋</span></button>)}{!visiblePhrases.length && <p className="noPhrases">Фраз не знайдено</p>}</div>
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
                  <div className="panelTitle"><div><h2>Перевірка протоколу</h2><p>Логіка, повнота та узгодженість</p></div><span className="reviewCount">{reviewItems.filter((item) => item.tone !== "ok").length}</span></div>
                  <div className="reviewList">{reviewItems.map((item) => <p className={item.tone} key={item.text}><i>{item.tone === "ok" ? "✓" : "!"}</i>{item.text}</p>)}</div>
                  <button disabled={reviewItems.some((item) => item.tone === "error")} onClick={() => reviewItems.some((item) => item.tone === "warn") ? notify("Перевірте незаповнені поля") : setShowPreview(true)}>Перегляд і підпис</button>
                </section>
                <section className="history panel">
                  <div className="panelTitle"><div><h2>Останні протоколи</h2><p>Збережені на цьому пристрої</p></div><span>{history.length}</span></div>
                  {history.length ? history.slice(0, 3).map((item) => <div className="historyItem" key={item.id}><i>✓</i><div><strong>{item.patient}</strong><small>{item.date} • КТ головного мозку</small></div><em>{item.status}</em></div>) : <div className="historyEmpty">Підписаних протоколів ще немає</div>}
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
      {showPreview && <div className="previewOverlay" role="dialog" aria-modal="true">
        <section className="protocolPreview">
          <div className="previewToolbar"><div><small>ПОПЕРЕДНІЙ ПЕРЕГЛЯД</small><strong>КТ головного мозку</strong></div><div><button onClick={() => setShowPreview(false)}>Закрити</button><button onClick={downloadProtocol}>Завантажити DOC</button><button onClick={() => window.print()}>Друк / PDF</button></div></div>
          <article className="paper">
            <header><div><strong>Чернігівський військовий госпіталь</strong><span>Відділення променевої діагностики</span></div><b>RadiologyOS</b></header>
            <h1>МСКТ головного мозку</h1>
            <div className="paperMeta"><p><span>Пацієнт</span><strong>{patientName}</strong></p><p><span>Дата дослідження</span><strong>26.07.2026</strong></p><p><span>Лікар</span><strong>Дмитро Адаменко</strong></p></div>
            <section><h2>Опис дослідження</h2><p>{description}</p></section>
            <section><h2>Висновок</h2><p><strong>{conclusion}</strong></p></section>
            <footer><div><span>Лікар-рентгенолог</span><strong>Дмитро Адаменко</strong></div><div className="signature">Електронний підпис</div></footer>
          </article>
          <div className="signBar"><span>Після підписання протокол буде додано до історії</span><button onClick={finalizeProtocol}>✓ Підписати та завершити</button></div>
        </section>
      </div>}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
