import Link from "next/link";
import StaffWorkspaceShell from "../workspace-shell";

const directories=[
  {name:"Персонал",description:"Кадрові картки працівників: підрозділ, посада, контакти, адреса та зв’язок з обліковим записом.",href:"/staff/personnel"},
  {name:"Обладнання",description:"Апарати, кабінети та технічні атрибути, що використовуються в записах і виконанні.",href:"/staff/equipment"},
  {name:"Послуги",description:"Канонічний каталог послуг, тривалість, правила і матеріальні норми.",href:"/staff/services"},
  {name:"Тарифи",description:"Ціни та правила оплати, які використовуються при формуванні замовлення і послуги.",href:"/staff/tariffs"},
  {name:"Склади",description:"Місця зберігання для документів надходження, списання, переміщення й інвентаризації.",href:"/staff/warehouses"},
  {name:"Контрагенти",description:"Постачальники та інші сторони господарських операцій.",href:"/staff/counterparties"},
  {name:"Графік кабінетів",description:"Робочі інтервали, що визначають доступність запису.",href:"/staff/schedule"},
  {name:"Графік змін персоналу",description:"Циклічні зміни, бригади та персональні корекції.",href:"/staff/shifts"},
  {name:"Облікові записи і ролі",description:"Доступ до RadiologyOS: користувачі, ролі та права. Обліковий запис не є кадровою карткою.",href:"/staff#staff-admin"},
];

export default function DirectoriesPage(){
  return <StaffWorkspaceShell
    active="directories"
    title="Довідники"
    description="Єдині master-data RadiologyOS: значення задаються один раз і повторно використовуються документами, регістрами та звітами."
  >
    <section className="financeSummary" aria-label="Принцип довідників">
      <article><span>Єдине джерело</span><b>Master data</b><small>без копій у формах</small></article>
      <article><span>Документи</span><b>Посилаються</b><small>на канонічні сутності</small></article>
      <article><span>Tenant scope</span><b>Ізольовано</b><small>по організації</small></article>
      <article><span>Історія</span><b>Стабільна</b><small>документи не переписуються заднім числом</small></article>
    </section>

    <section className="financeJournal">
      <header className="financeToolbar"><div><b>Карта довідників</b><small>Змінюйте нормативно-довідкові дані тут, а не всередині кожного документа.</small></div></header>
      <div className="financeTableWrap"><table className="financeTable">
        <thead><tr><th>Довідник</th><th>Призначення</th><th/></tr></thead>
        <tbody>{directories.map(item=><tr key={item.name}>
          <td><b>{item.name}</b></td><td>{item.description}</td><td><Link className="excelButton" href={item.href}>Відкрити</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </StaffWorkspaceShell>;
}