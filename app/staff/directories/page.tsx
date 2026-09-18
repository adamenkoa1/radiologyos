import Link from "next/link";
import StaffWorkspaceShell from "../workspace-shell";

const directories=[
  {name:"Персонал",description:"Кадрові картки працівників: підрозділ, посада, контакти, адреса та зв’язок з обліковим записом.",href:"/staff/personnel"},
  {name:"ВЛК персоналу",description:"Окрема захищена append-only історія рішень ВЛК, прив’язана до стабільного personnelId.",href:"/staff/personnel/vlk"},
  {name:"Допуск до ДІВ",description:"Append-only історія кадрових рішень щодо робіт з джерелами іонізуючого випромінювання.",href:"/staff/personnel/radiation-clearance"},
  {name:"Радіаційна безпека",description:"Навчання, перевірки знань та інструктажі з окремою історією сертифікатів і строків дії.",href:"/staff/personnel/radiation-training"},
  {name:"Індивідуальна дозиметрія",description:"Захищена append-only історія персонального дозиметричного контролю Hp(10), Hp(0.07) та Hp(3).",href:"/staff/personnel/dosimetry"},
  {name:"Контингент радіаційного контролю",description:"Явний append-only організаційний scope персоналу для радіаційного review без автоматичної правової категоризації.",href:"/staff/personnel/radiation-monitoring-scope"},
  {name:"Дозове зведення",description:"Read-only subtotal тільки виміряних Hp(10), Hp(0.07) та Hp(3) за період; ненумеричні статуси не трактуються як нуль.",href:"/staff/personnel/radiation-dose-summary"},
  {name:"Зведення ДІВ",description:"Read-only проекція допуску, навчання, перевірок знань і стану дозиметрії без автоматичного блокування роботи.",href:"/staff/personnel/radiation-compliance"},
  {name:"Черга review ДІВ",description:"Read-only робочий список детермінованих review-причин зі зведення ДІВ без alerts, дозових порогів або operational enforcement.",href:"/staff/personnel/radiation-review-queue"},
  {name:"Політика ДІВ",description:"Append-only організаційні критерії review без прихованих нормативів, дозових лімітів або operational enforcement.",href:"/staff/personnel/radiation-review-policy"},
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
