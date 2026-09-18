"use client";

import { useEffect,useState } from "react";
import { REGISTER_REPORT_UI_SECTIONS,resolveRegisterReportPeriod,type RegisterReportPeriodPreset,type RegisterReportSection } from "../../../../lib/register-report-view-ui";
import StaffWorkspaceShell from "../../workspace-shell";

type Turnover={increase:number;decrease:number;net:number};
type Balance=Turnover&{opening:number;closing:number};
type Report={
  period:{from:string;to:string};generatedAt:string;
  registers:{
    revenue:Turnover;cash:Turnover;settlements:Balance;expenses:Turnover;
    services:Turnover&{regionsNet:number};equipment:Turnover;staff:Turnover;
  };
  breakdowns:{
    revenueByService:Array<{serviceCode:string;accrued:number;reversed:number;net:number}>;
    cashByMethod:Array<{method:string;incoming:number;outgoing:number;net:number}>;
    expensesByItem:Array<{itemId:number;sku:string;name:string;unit:string;amount:number;movementCount:number}>;
    equipment:Array<{equipmentId:string;loadedMinutes:number;reversedMinutes:number;netMinutes:number}>;
    staff:Array<{memberEmail:string;staffRole:string;performed:number;reversed:number;net:number}>;
    inventory:Array<{itemId:number;sku:string;name:string;unit:string;opening:number;incoming:number;outgoing:number;closing:number}>;
    inventoryByWarehouse:Array<{warehouseId:number;warehouseCode:string;warehouseName:string;itemId:number;sku:string;name:string;unit:string;opening:number;incoming:number;outgoing:number;closing:number}>;
  };
  error?:string;
};
type SavedView={id:number;name:string;configuration:{periodPreset:RegisterReportPeriodPreset;from:string;to:string;sections:RegisterReportSection[]}};

function todayInKyiv(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
const today=todayInKyiv();
const initialPeriod=resolveRegisterReportPeriod("current_month",today,"","");
const allSections=REGISTER_REPORT_UI_SECTIONS.map(item=>item.key);
function money(value:number){return new Intl.NumberFormat("uk-UA",{style:"currency",currency:"UAH",maximumFractionDigits:0}).format(Number(value||0));}
function number(value:number){return new Intl.NumberFormat("uk-UA",{maximumFractionDigits:2}).format(Number(value||0));}
const METHOD_UK:Record<string,string>={cash:"Готівка",card:"Картка",bank_transfer:"Банківський переказ",privat_link:"Privat24",other:"Інше"};
const ROLE_UK:Record<string,string>={radiologist:"Лікар-рентгенолог",radiographer:"Рентгенолаборант"};

export default function RegisterTurnoverPage(){
  const [preset,setPreset]=useState<RegisterReportPeriodPreset>("current_month");
  const [from,setFrom]=useState(initialPeriod.from);
  const [to,setTo]=useState(initialPeriod.to);
  const [sections,setSections]=useState<RegisterReportSection[]>(allSections);
  const [data,setData]=useState<Report|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [views,setViews]=useState<SavedView[]>([]);
  const [viewsAvailable,setViewsAvailable]=useState<boolean|null>(null);
  const [selectedViewId,setSelectedViewId]=useState("");
  const [viewName,setViewName]=useState("");
  const [viewBusy,setViewBusy]=useState(false);
  const [viewMessage,setViewMessage]=useState("");

  async function load(nextFrom=from,nextTo=to){
    setLoading(true);setError("");
    try{
      const params=new URLSearchParams({from:nextFrom,to:nextTo});
      const response=await fetch(`/api/staff/reports/registers?${params}`,{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as Report;
      if(!response.ok)throw new Error(payload.error||"Не вдалося сформувати обороти регістрів");
      setData(payload);
    }catch(e){setData(null);setError(e instanceof Error?e.message:"Не вдалося сформувати обороти регістрів");}
    finally{setLoading(false);}
  }

  async function loadViews(){
    try{
      const response=await fetch("/api/staff/reports/views",{cache:"no-store"});
      if(response.status===403){setViewsAvailable(false);setViews([]);return;}
      const payload=await response.json().catch(()=>({})) as {views?:SavedView[]};
      if(!response.ok)throw new Error("saved_views_unavailable");
      setViews(Array.isArray(payload.views)?payload.views:[]);setViewsAvailable(true);
    }catch{setViewsAvailable(false);setViews([]);}
  }

  useEffect(()=>{const timer=window.setTimeout(()=>{void load();void loadViews();},0);return()=>window.clearTimeout(timer);/* eslint-disable-next-line react-hooks/exhaustive-deps */},[]);

  function changePreset(next:RegisterReportPeriodPreset){
    setPreset(next);
    if(next!=="custom"){
      const period=resolveRegisterReportPeriod(next,today,from,to);setFrom(period.from);setTo(period.to);
    }
  }
  function toggleSection(section:RegisterReportSection){
    setSections(current=>current.includes(section)
      ?current.length===1?current:current.filter(item=>item!==section)
      :[...current,section]);
  }
  async function applyView(){
    const view=views.find(item=>String(item.id)===selectedViewId);if(!view)return;
    const period=resolveRegisterReportPeriod(view.configuration.periodPreset,today,view.configuration.from,view.configuration.to);
    setPreset(view.configuration.periodPreset);setFrom(period.from);setTo(period.to);setSections(view.configuration.sections);setViewMessage(`Застосовано: ${view.name}`);
    await load(period.from,period.to);
  }
  async function saveView(){
    const name=viewName.trim();if(!name){setViewMessage("Вкажіть назву варіанта.");return;}
    setViewBusy(true);setViewMessage("");
    try{
      const response=await fetch("/api/staff/reports/views",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,configuration:{periodPreset:preset,from:preset==="custom"?from:"",to:preset==="custom"?to:"",sections}})});
      const payload=await response.json().catch(()=>({})) as {view?:SavedView;error?:string};
      if(!response.ok)throw new Error(payload.error||"Не вдалося зберегти варіант");
      await loadViews();setSelectedViewId(payload.view?String(payload.view.id):"");setViewName("");setViewMessage("Варіант збережено.");
    }catch(e){setViewMessage(e instanceof Error?e.message:"Не вдалося зберегти варіант");}
    finally{setViewBusy(false);}
  }
  async function deleteView(){
    if(!selectedViewId||!window.confirm("Видалити збережений варіант звіту?"))return;
    setViewBusy(true);setViewMessage("");
    try{
      const response=await fetch(`/api/staff/reports/views?id=${encodeURIComponent(selectedViewId)}`,{method:"DELETE"});
      const payload=await response.json().catch(()=>({})) as {error?:string};if(!response.ok)throw new Error(payload.error||"Не вдалося видалити варіант");
      setSelectedViewId("");await loadViews();setViewMessage("Варіант видалено.");
    }catch(e){setViewMessage(e instanceof Error?e.message:"Не вдалося видалити варіант");}
    finally{setViewBusy(false);}
  }

  const sectionEnabled=(section:RegisterReportSection)=>sections.includes(section);
  const exportHref=`/api/staff/reports/registers/export?${new URLSearchParams({from,to,sections:sections.join(",")}).toString()}`;

  return <StaffWorkspaceShell
    active="reports"
    title="Обороти і залишки"
    description="BAS-звіт без ручних KPI: показники обчислюються безпосередньо з immutable регістрів рухів."
  >
    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Період звіту</b><small>До 366 днів. Сторно та повернення потрапляють у період за датою власного руху.</small></div>
        <label><span>Період</span><select value={preset} onChange={e=>changePreset(e.target.value as RegisterReportPeriodPreset)}><option value="current_month">Поточний місяць</option><option value="last_30_days">Останні 30 днів</option><option value="custom">Власний період</option></select></label>
        <label><span>Від</span><input type="date" value={from} disabled={preset!=="custom"} onChange={e=>setFrom(e.target.value)}/></label>
        <label><span>До</span><input type="date" value={to} disabled={preset!=="custom"} onChange={e=>setTo(e.target.value)}/></label>
        <button type="button" disabled={loading} onClick={()=>void load()}>{loading?"Формування…":"Сформувати"}</button>
        {viewsAvailable===true&&<a className="excelButton" href={exportHref}>CSV</a>}
        <a className="excelButton" href="/staff/reports/receivables">Дебіторська заборгованість</a>
      </header>
      {error&&<p className="financeError">{error}</p>}
    </section>

    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Розділи звіту</b><small>Вибір змінює лише представлення та CSV; суми завжди обчислює сервер із регістрів.</small></div>
        {REGISTER_REPORT_UI_SECTIONS.map(item=><label key={item.key}><input type="checkbox" checked={sectionEnabled(item.key)} disabled={sectionEnabled(item.key)&&sections.length===1} onChange={()=>toggleSection(item.key)}/><span>{item.label}</span></label>)}
      </header>
    </section>

    {viewsAvailable===true&&<section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Збережені варіанти</b><small>Зберігаються лише назва, preset періоду та перелік розділів — без сум і медичних даних.</small></div>
        <label><span>Новий варіант</span><input value={viewName} maxLength={80} placeholder="Напр. Місячний склад" onChange={e=>setViewName(e.target.value)}/></label>
        <button type="button" disabled={viewBusy} onClick={()=>void saveView()}>Зберегти</button>
        <label><span>Збережено</span><select value={selectedViewId} onChange={e=>setSelectedViewId(e.target.value)}><option value="">Оберіть варіант</option>{views.map(view=><option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
        <button type="button" disabled={viewBusy||!selectedViewId} onClick={()=>void applyView()}>Застосувати</button>
        <button type="button" disabled={viewBusy||!selectedViewId} onClick={()=>void deleteView()}>Видалити</button>
      </header>
      {viewMessage&&<p className="financeHint">{viewMessage}</p>}
    </section>}

    {data&&<>
      {sectionEnabled("summary")&&<>
        <section className="financeSummary" aria-label="Обороти регістрів">
          <article><span>Дохід, нетто</span><b>{money(data.registers.revenue.net)}</b><small>+{money(data.registers.revenue.increase)} · сторно {money(data.registers.revenue.decrease)}</small></article>
          <article><span>Гроші, нетто</span><b>{money(data.registers.cash.net)}</b><small>вхід {money(data.registers.cash.increase)} · вихід {money(data.registers.cash.decrease)}</small></article>
          <article><span>Борг / кредит пацієнтів</span><b>{money(data.registers.settlements.closing)}</b><small>початок {money(data.registers.settlements.opening)}</small></article>
          <article><span>Послуги, нетто</span><b>{number(data.registers.services.net)}</b><small>виконано {number(data.registers.services.increase)} · сторно {number(data.registers.services.decrease)} · зон {number(data.registers.services.regionsNet)}</small></article>
          <article><span>Навантаження обладнання</span><b>{number(data.registers.equipment.net)} хв</b><small>+{number(data.registers.equipment.increase)} · сторно {number(data.registers.equipment.decrease)}</small></article>
          <article><span>Виробіток персоналу</span><b>{number(data.registers.staff.net)}</b><small>+{number(data.registers.staff.increase)} · сторно {number(data.registers.staff.decrease)}</small></article>
          <article><span>Витрати матеріалів</span><b>{money(data.registers.expenses.net)}</b><small>lot-cost із проведених списань</small></article>
        </section>
        <section className="financeJournal">
          <header className="financeToolbar"><div><b>Взаєморозрахунки з пацієнтами</b><small>Додатне сальдо — пацієнти винні організації; від’ємне — кредит пацієнтів.</small></div></header>
          <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Початкове сальдо</th><th className="num">Збільшення боргу</th><th className="num">Зменшення / оплати</th><th className="num">Оборот нетто</th><th className="num">Кінцеве сальдо</th></tr></thead><tbody><tr>
            <td className="num">{money(data.registers.settlements.opening)}</td><td className="num positive">+{money(data.registers.settlements.increase)}</td><td className="num negative">−{money(data.registers.settlements.decrease)}</td><td className="num">{money(data.registers.settlements.net)}</td><td className="num"><b>{money(data.registers.settlements.closing)}</b></td>
          </tr></tbody></table></div>
        </section>
      </>}

      {sectionEnabled("revenue")&&<section className="financeJournal">
        <header className="financeToolbar"><div><b>Дохід за послугами</b><small>Нарахування і сторно з `revenue_movements`.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Код послуги</th><th className="num">Нараховано</th><th className="num">Сторновано</th><th className="num">Нетто</th></tr></thead><tbody>
          {data.breakdowns.revenueByService.map(row=><tr key={row.serviceCode}><td><b>{row.serviceCode}</b></td><td className="num positive">{money(row.accrued)}</td><td className="num negative">{money(row.reversed)}</td><td className="num"><b>{money(row.net)}</b></td></tr>)}
          {data.breakdowns.revenueByService.length===0&&<tr><td colSpan={4}>Рухів доходу за період немає.</td></tr>}
        </tbody></table></div>
      </section>}

      {sectionEnabled("cash")&&<section className="financeJournal">
        <header className="financeToolbar"><div><b>Гроші за способом оплати</b><small>Cash — окремий регістр; сторно послуги тут нічого не змінює.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Спосіб</th><th className="num">Надійшло</th><th className="num">Повернено</th><th className="num">Нетто</th></tr></thead><tbody>
          {data.breakdowns.cashByMethod.map(row=><tr key={row.method}><td>{METHOD_UK[row.method]||row.method||"—"}</td><td className="num positive">{money(row.incoming)}</td><td className="num negative">{money(row.outgoing)}</td><td className="num"><b>{money(row.net)}</b></td></tr>)}
          {data.breakdowns.cashByMethod.length===0&&<tr><td colSpan={4}>Рухів грошей за період немає.</td></tr>}
        </tbody></table></div>
      </section>}

      {sectionEnabled("expenses")&&<section className="financeJournal">
        <header className="financeToolbar"><div><b>Витрати матеріалів за собівартістю</b><small>Immutable `expense_movements`: вартість списання береться з receipt-line партії, а не вводиться вручну.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Матеріал</th><th>Од.</th><th className="num">Рухів</th><th className="num">Витрати</th></tr></thead><tbody>
          {data.breakdowns.expensesByItem.map(row=><tr key={row.itemId}><td><b>{row.name}</b><small>{row.sku||`#${row.itemId}`}</small></td><td>{row.unit}</td><td className="num">{number(row.movementCount)}</td><td className="num"><b>{money(row.amount)}</b></td></tr>)}
          {data.breakdowns.expensesByItem.length===0&&<tr><td colSpan={4}>Оцінених списань за період немає.</td></tr>}
        </tbody></table></div>
      </section>}

      {sectionEnabled("equipment")&&<section className="financeJournal">
        <header className="financeToolbar"><div><b>Навантаження обладнання</b><small>Фактичні хвилини виконання мінус сторно.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Апарат</th><th className="num">Нараховано хв</th><th className="num">Сторно хв</th><th className="num">Нетто хв</th></tr></thead><tbody>
          {data.breakdowns.equipment.map(row=><tr key={row.equipmentId}><td><b>{row.equipmentId}</b></td><td className="num">{number(row.loadedMinutes)}</td><td className="num">{number(row.reversedMinutes)}</td><td className="num"><b>{number(row.netMinutes)}</b></td></tr>)}
          {data.breakdowns.equipment.length===0&&<tr><td colSpan={4}>Рухів обладнання за період немає.</td></tr>}
        </tbody></table></div>
      </section>}

      {sectionEnabled("staff")&&<section className="financeJournal">
        <header className="financeToolbar"><div><b>Виробіток персоналу</b><small>Проведені одиниці мінус сторно.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Працівник</th><th>Роль</th><th className="num">Виконано</th><th className="num">Сторно</th><th className="num">Нетто</th></tr></thead><tbody>
          {data.breakdowns.staff.map(row=><tr key={`${row.memberEmail}-${row.staffRole}`}><td><b>{row.memberEmail}</b></td><td>{ROLE_UK[row.staffRole]||row.staffRole}</td><td className="num">{number(row.performed)}</td><td className="num">{number(row.reversed)}</td><td className="num"><b>{number(row.net)}</b></td></tr>)}
          {data.breakdowns.staff.length===0&&<tr><td colSpan={5}>Рухів персоналу за період немає.</td></tr>}
        </tbody></table></div>
      </section>}

      {sectionEnabled("inventory")&&<section className="financeJournal">
        <header className="financeToolbar"><div><b>Склад: обороти і залишки</b><small>Загальний баланс організації з `inventory_movements`, незалежно від місця зберігання.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Матеріал</th><th>Од.</th><th className="num">На початок</th><th className="num">Надійшло</th><th className="num">Вибуло</th><th className="num">На кінець</th></tr></thead><tbody>
          {data.breakdowns.inventory.map(row=><tr key={row.itemId}><td><b>{row.name}</b><small>{row.sku||`#${row.itemId}`}</small></td><td>{row.unit}</td><td className="num">{number(row.opening)}</td><td className="num positive">{number(row.incoming)}</td><td className="num negative">{number(row.outgoing)}</td><td className="num"><b>{number(row.closing)}</b></td></tr>)}
          {data.breakdowns.inventory.length===0&&<tr><td colSpan={6}>Складських рухів і залишків немає.</td></tr>}
        </tbody></table></div>
      </section>}

      {sectionEnabled("inventory_by_warehouse")&&<section className="financeJournal">
        <header className="financeToolbar"><div><b>Склад: по місцях зберігання</b><small>Історичний розріз використовує snapshot складу з кожного immutable руху.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Склад</th><th>Матеріал</th><th>Од.</th><th className="num">На початок</th><th className="num">Надійшло</th><th className="num">Вибуло</th><th className="num">На кінець</th></tr></thead><tbody>
          {data.breakdowns.inventoryByWarehouse.map(row=><tr key={`${row.warehouseId}-${row.warehouseCode}-${row.itemId}`}><td><b>{row.warehouseName}</b><small>{row.warehouseCode||`#${row.warehouseId}`}</small></td><td><b>{row.name}</b><small>{row.sku||`#${row.itemId}`}</small></td><td>{row.unit}</td><td className="num">{number(row.opening)}</td><td className="num positive">{number(row.incoming)}</td><td className="num negative">{number(row.outgoing)}</td><td className="num"><b>{number(row.closing)}</b></td></tr>)}
          {data.breakdowns.inventoryByWarehouse.length===0&&<tr><td colSpan={7}>Складських рухів із прив’язкою до місця зберігання немає.</td></tr>}
        </tbody></table></div>
      </section>}
    </>}
  </StaffWorkspaceShell>;
}
