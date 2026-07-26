import React,{useState} from "react";
import{createRoot}from"react-dom/client";
import"./styles.css";
const studies=[
["08:30","Коваленко Олександр","КТ головного мозку","КТ №1","Завершено","done"],
["09:10","Мельник Андрій","КТ ОГК","КТ №1","Описується","active"],
["10:00","Бондаренко Сергій","КТ ОЧП з контрастом","КТ №1","Очікує","wait"],
["10:40","Шевченко Максим","Рентген гомілки","Рентген №2","Очікує","wait"],
["11:20","Ткаченко Віталій","КТ поперекового відділу","КТ №1","Заплановано","planned"]];
const nav=["Огляд","Пацієнти","Дослідження","Розклад","Протоколи","Звіти"];
function App(){
 const[query,setQuery]=useState("");const[notice,setNotice]=useState("");
 const show=m=>{setNotice(m);setTimeout(()=>setNotice(""),2200)};
 const filtered=studies.filter(s=>s.join(" ").toLowerCase().includes(query.toLowerCase()));
 return <main className="shell">
  <aside><div className="brand"><b>✣</b>Radiology<span>OS</span></div><small>РОБОЧИЙ ПРОСТІР</small>
   <nav>{nav.map((n,i)=><button className={i===0?"active":""} onClick={()=>i&&show(n+": модуль наступного етапу")} key={n}>{["⌂","♙","▣","□","≡","↗"][i]} <span>{n}</span></button>)}</nav>
   <div className="department"><small>ВІДДІЛЕННЯ</small><strong>Променева діагностика</strong><p>Чернігівський військовий госпіталь</p></div>
   <div className="profile"><i>ДА</i><span><strong>Дмитро Адаменко</strong><small>Керівник відділення</small></span></div>
  </aside>
  <section className="workspace"><header><label>⌕<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пошук пацієнта або дослідження..."/></label><button onClick={()=>show("Форма нового дослідження — наступний етап")}>＋ Нове дослідження</button></header>
   <div className="content"><div className="welcome"><div><small>НЕДІЛЯ, 26 ЛИПНЯ</small><h1>Добрий вечір, Дмитре</h1><p>Ось актуальна ситуація у відділенні на сьогодні.</p></div><span>● Зміна активна　<b>07:00 — 19:00</b></span></div>
    <section className="metrics">{[["▣","ДОСЛІДЖЕНЬ СЬОГОДНІ","18","↑ 12% від учора"],["◷","ОЧІКУЮТЬ ОПИСУ","5","2 термінових"],["✓","ЗАВЕРШЕНО","11","61% від плану"],["♙","ПАЦІЄНТІВ","16","3 нових"]].map((m,i)=><article key={m[1]}><i className={"c"+i}>{m[0]}</i><div><small>{m[1]}</small><strong>{m[2]}</strong><p>{m[3]}</p></div></article>)}</section>
    <div className="grid"><section className="panel schedule"><div className="title"><div><h2>Розклад на сьогодні</h2><p>Найближчі дослідження та їх статус</p></div><button onClick={()=>show("Повний розклад")}>Весь розклад →</button></div>
     <div className="thead"><span>ЧАС</span><span>ПАЦІЄНТ</span><span>ДОСЛІДЖЕННЯ</span><span>КАБІНЕТ</span><span>СТАТУС</span></div>
     {filtered.map(s=><button className="row" onClick={()=>show(s[1]+": "+s[2])} key={s[0]}><strong>{s[0]}</strong><span className="patient"><i>{s[1].split(" ").map(x=>x[0]).join("")}</i>{s[1]}</span><span>{s[2]}</span><span>{s[3]}</span><em className={s[5]}>{s[4]}</em></button>)}
    </section>
    <div className="right"><section className="panel workload"><div className="title"><div><h2>Навантаження</h2><p>За типом досліджень</p></div></div><div className="donut"><span><b>18</b><small>усього</small></span></div><p>🔵 КТ <b>12　67%</b></p><p>🟢 Рентген <b>4　22%</b></p><p>🟣 Рентгеноскопія <b>2　11%</b></p></section>
    <section className="panel quick"><div className="title"><div><h2>Швидкі дії</h2><p>Часті операції</p></div></div><div>{["Новий пацієнт","Створити протокол","Звіт за зміну"].map(x=><button onClick={()=>show(x)} key={x}>＋<span>{x}</span></button>)}</div></section></div></div>
   </div>
  </section>{notice&&<div className="toast">{notice}</div>}</main>
}
createRoot(document.getElementById("root")).render(<App/>);
