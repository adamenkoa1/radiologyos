import Link from "next/link";
import StaffWorkspaceShell from "../workspace-shell";

const registers=[
  {name:"Гроші",description:"Оплати та повернення. Джерело — проведені фінансові документи й cash movements.",href:"/staff/finance",cta:"Відкрити фінанси"},
  {name:"Взаєморозрахунки",description:"Сальдо пацієнтів і рухи боргу/кредиту без ручного перерахунку.",href:"/staff/finance",cta:"Відкрити сальдо"},
  {name:"Дохід",description:"Нарахування за наданими послугами та сторно з immutable revenue movements.",href:"/staff/reports/registers",cta:"Обороти доходу"},
  {name:"Надані послуги",description:"Факти service delivery і корекції, прив’язані до канонічних документів.",href:"/staff/finance/services",cta:"Журнал послуг"},
  {name:"Склад",description:"Надходження, списання, переміщення й інвентаризаційні коригування по партіях і складах.",href:"/staff/inventory",cta:"Складські рухи"},
  {name:"Навантаження обладнання",description:"Хвилини фактичного виконання та сторно по обладнанню.",href:"/staff/reports/registers",cta:"Обороти обладнання"},
  {name:"Виробіток персоналу",description:"Фактичні виконання і сторно по працівниках без ручних KPI.",href:"/staff/reports/registers",cta:"Обороти персоналу"},
  {name:"Матеріальні витрати",description:"Фактична собівартість із проведених списань і партійної вартості.",href:"/staff/reports/material-margin",cta:"Маржинальність"},
];

export default function RegistersPage(){
  return <StaffWorkspaceShell
    active="registers"
    title="Регістри"
    description="BAS-контур фактів: документ проводить рухи, регістр зберігає immutable стан, звіт лише читає ці факти."
  >
    <section className="financeSummary" aria-label="Принцип роботи регістрів">
      <article><span>1. Документ</span><b>Реєстратор</b><small>канонічна бізнес-подія</small></article>
      <article><span>2. Проведення</span><b>Рухи</b><small>атомарні зміни регістрів</small></article>
      <article><span>3. Регістр</span><b>Факт</b><small>immutable історія</small></article>
      <article><span>4. Звіт</span><b>Read model</b><small>без дублювання логіки</small></article>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Карта регістрів RadiologyOS</b><small>Це навігація до канонічних read-model. Вона не створює паралельних таблиць і не рахує показники в браузері.</small></div>
        <Link className="excelButton" href="/staff/documents">Журнал документів</Link>
        <Link className="excelButton" href="/staff/reports/registers">Обороти і залишки</Link>
      </header>
      <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Регістр</th><th>Що зберігає</th><th>Робочий екран</th></tr></thead>
        <tbody>{registers.map(item=><tr key={item.name}>
          <td><b>{item.name}</b></td>
          <td>{item.description}</td>
          <td><Link className="excelButton" href={item.href}>{item.cta}</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Ключова перевага BAS-підходу</b><small>Суми, залишки та статуси не є окремими «цифрами на дашборді». Вони відтворюються з проведених документів і рухів, а сторно зберігає повну історію.</small></div></header>
      <div className="financePrintDetails">
        <p><span>Ланцюжок</span><b>Підстава → Документ → Проведення → Регістр → Звіт</b></p>
        <p><span>Виправлення</span><b>Сторно / корекція замість видалення історії</b></p>
        <p><span>Контроль</span><b>Tenant scope + D1 invariants + audit</b></p>
      </div>
    </section>
  </StaffWorkspaceShell>;
}
