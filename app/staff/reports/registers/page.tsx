"use client";

import { useEffect,useState } from "react";
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

function todayInKyiv(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
const today=todayInKyiv();
const monthStart=`${today.slice(0,7)}-01`;
function money(value:number){return new Intl.NumberFormat("uk-UA",{style:"currency",currency:"UAH",maximumFractionDigits:0}).format(Number(value||0));}
function number(value:number){return new Intl.NumberFormat("uk-UA",{maximumFractionDigits:2}).format(Number(value||0));}
const METHOD_UK:Record<string,string>={cash:"Готівка",card:"Картка",bank_transfer:"Банківський переказ",privat_link:"Privat24",other:"Інше"};
const ROLE_UK:Record<string,string>={radiologist:"Лікар-рентгенолог",radiographer:"Рентгенолаборант"};

export default function RegisterTurnoverPage(){
  const [from,setFrom]=useState(monthStart);
  const [to,setTo]=useState(today);
  const [data,setData]=useState<Report|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);

  async function load(){
    setLoading(true);setError("");
    try{
      const params=new URLSearchParams({from,to});
      const response=await fetch(`/api/staff/reports/registers?${params}`,{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as Report;
      if(!response.ok)throw new Error(payload.error||"Не вдалося сформувати обороти регістрів");
      setData(payload);
    }catch(e){setData(null);setError(e instanceof Error?e.message:"Не вдалося сформувати обороти регістрів");}
    finally{setLoading(false);}
  }

  useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>window.clearTimeout(timer);/* eslint-disable-next-line react-hooks/exhaustive-deps */},[]);

  return <StaffWorkspaceShell
    active="reports"
    title="Обороти і залишки"
    description="BAS-звіт без ручних KPI: показники обчислюються безпосередньо з immutable регістрів рухів."
  >
    <section className="financeJournal">
      <header className="financeToolbar">
        <div><b>Період звіту</b><small>До 366 днів. Сторно та повернення потрапляють у період за датою власного руху.</small></div>
        <label><span>Від</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label><span>До</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <button type="button" disabled={loading} onClick={()=>void load()}>{loading?"Формування…":"Сформувати"}</button>
        <a className="excelButton" href="/staff/reports/receivables">Дебіторська заборгованість</a>
      </header>
      {error&&<p className="financeError">{error}</p>}
    </section>

    {data&&<>
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

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>Дохід за послугами</b><small>Нарахування і сторно з `revenue_movements`.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Код послуги</th><th className="num">Нараховано</th><th className="num">Сторновано</th><th className="num">Нетто</th></tr></thead><tbody>
          {data.breakdowns.revenueByService.map(row=><tr key={row.serviceCode}><td><b>{row.serviceCode}</b></td><td className="num positive">{money(row.accrued)}</td><td className="num negative">{money(row.reversed)}</td><td className="num"><b>{money(row.net)}</b></td></tr>)}
          {data.breakdowns.revenueByService.length===0&&<tr><td colSpan={4}>Рухів доходу за період немає.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>Гроші за способом оплати</b><small>Cash — окремий регістр; сторно послуги тут нічого не змінює.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Спосіб</th><th className="num">Надійшло</th><th className="num">Повернено</th><th className="num">Нетто</th></tr></thead><tbody>
          {data.breakdowns.cashByMethod.map(row=><tr key={row.method}><td>{METHOD_UK[row.method]||row.method||"—"}</td><td className="num positive">{money(row.incoming)}</td><td className="num negative">{money(row.outgoing)}</td><td className="num"><b>{money(row.net)}</b></td></tr>)}
          {data.breakdowns.cashByMethod.length===0&&<tr><td colSpan={4}>Рухів грошей за період немає.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>Витрати матеріалів за собівартістю</b><small>Immutable `expense_movements`: вартість списання береться з receipt-line партії, а не вводиться вручну.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Матеріал</th><th>Од.</th><th className="num">Рухів</th><th className="num">Витрати</th></tr></thead><tbody>
          {data.breakdowns.expensesByItem.map(row=><tr key={row.itemId}><td><b>{row.name}</b><small>{row.sku||`#${row.itemId}`}</small></td><td>{row.unit}</td><td className="num">{number(row.movementCount)}</td><td className="num"><b>{money(row.amount)}</b></td></tr>)}
          {data.breakdowns.expensesByItem.length===0&&<tr><td colSpan={4}>Оцінених списань за період немає.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>Навантаження обладнання</b><small>Фактичні хвилини виконання мінус сторно.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Апарат</th><th className="num">Нараховано хв</th><th className="num">Сторно хв</th><th className="num">Нетто хв</th></tr></thead><tbody>
          {data.breakdowns.equipment.map(row=><tr key={row.equipmentId}><td><b>{row.equipmentId}</b></td><td className="num">{number(row.loadedMinutes)}</td><td className="num">{number(row.reversedMinutes)}</td><td className="num"><b>{number(row.netMinutes)}</b></td></tr>)}
          {data.breakdowns.equipment.length===0&&<tr><td colSpan={4}>Рухів обладнання за період немає.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>Виробіток персоналу</b><small>Проведені одиниці мінус сторно.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Працівник</th><th>Роль</th><th className="num">Виконано</th><th className="num">Сторно</th><th className="num">Нетто</th></tr></thead><tbody>
          {data.breakdowns.staff.map(row=><tr key={`${row.memberEmail}-${row.staffRole}`}><td><b>{row.memberEmail}</b></td><td>{ROLE_UK[row.staffRole]||row.staffRole}</td><td className="num">{number(row.performed)}</td><td className="num">{number(row.reversed)}</td><td className="num"><b>{number(row.net)}</b></td></tr>)}
          {data.breakdowns.staff.length===0&&<tr><td colSpan={5}>Рухів персоналу за період немає.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>Склад: обороти і залишки</b><small>Загальний баланс організації з `inventory_movements`, незалежно від місця зберігання.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Матеріал</th><th>Од.</th><th className="num">На початок</th><th className="num">Надійшло</th><th className="num">Вибуло</th><th className="num">На кінець</th></tr></thead><tbody>
          {data.breakdowns.inventory.map(row=><tr key={row.itemId}><td><b>{row.name}</b><small>{row.sku||`#${row.itemId}`}</small></td><td>{row.unit}</td><td className="num">{number(row.opening)}</td><td className="num positive">{number(row.incoming)}</td><td className="num negative">{number(row.outgoing)}</td><td className="num"><b>{number(row.closing)}</b></td></tr>)}
          {data.breakdowns.inventory.length===0&&<tr><td colSpan={6}>Складських рухів і залишків немає.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="financeJournal">
        <header className="financeToolbar"><div><b>Склад: по місцях зберігання</b><small>Історичний розріз використовує snapshot складу з кожного immutable руху.</small></div></header>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Склад</th><th>Матеріал</th><th>Од.</th><th className="num">На початок</th><th className="num">Надійшло</th><th className="num">Вибуло</th><th className="num">На кінець</th></tr></thead><tbody>
          {data.breakdowns.inventoryByWarehouse.map(row=><tr key={`${row.warehouseId}-${row.warehouseCode}-${row.itemId}`}><td><b>{row.warehouseName}</b><small>{row.warehouseCode||`#${row.warehouseId}`}</small></td><td><b>{row.name}</b><small>{row.sku||`#${row.itemId}`}</small></td><td>{row.unit}</td><td className="num">{number(row.opening)}</td><td className="num positive">{number(row.incoming)}</td><td className="num negative">{number(row.outgoing)}</td><td className="num"><b>{number(row.closing)}</b></td></tr>)}
          {data.breakdowns.inventoryByWarehouse.length===0&&<tr><td colSpan={7}>Складських рухів із прив’язкою до місця зберігання немає.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </StaffWorkspaceShell>;
}
