"use client";

import { useEffect,useState } from "react";

type PrintLine={lineNo:number;itemId:number;itemName:string;unit:string;lotNumber:string;expiresOn:string;supplier:string;quantity:number;reason:string;bookingId:number|null};
type PrintPayload={templateVersion:number;formType:"inventory_receipt"|"inventory_writeoff";organization:{name:string};document:{id:number;number:string;documentType:string;occurredAt:string;state:string;comment:string;createdBy:string;createdAt:string;postedBy:string;postedAt:string};lines:PrintLine[]};
type Snapshot={id:number;documentId:number;formType:string;templateVersion:number;generatedBy:string;generatedAt:string;storageKey:string;sha256:string};
type ResponsePayload={snapshot:Snapshot;payload:PrintPayload;error?:string};

const TYPE_UK={inventory_receipt:"Надходження матеріалів",inventory_writeoff:"Списання матеріалів"} as const;
const STATE_UK:Record<string,string>={draft:"ЧЕРНЕТКА",posted:"Проведено",reversed:"Сторновано",cancelled:"Скасовано"};
function fmt(n:number){return Number(n||0).toLocaleString("uk-UA",{maximumFractionDigits:2});}
function fmtDate(v:string){const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString("uk-UA",{dateStyle:"medium",timeStyle:"short"});}

export default function InventoryPrintPage(){
  const [data,setData]=useState<ResponsePayload|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      const id=Number(new URLSearchParams(window.location.search).get("id"));
      if(!Number.isInteger(id)||id<1){setError("Некоректний документ");return;}
      void fetch("/api/staff/inventory/documents/print",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({documentId:id}),signal:controller.signal,
      }).then(async r=>{
        const p=await r.json().catch(()=>({})) as ResponsePayload;
        if(!r.ok) throw new Error(p.error||"Не вдалося сформувати друковану форму");
        setData(p);
      }).catch(e=>{if(e?.name!=="AbortError")setError(e instanceof Error?e.message:"Помилка друку");});
    },0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[]);

  if(error)return <main className="inventoryPrintPage"><div className="inventoryPrintSheet"><h1>Не вдалося сформувати документ</h1><p>{error}</p></div></main>;
  if(!data)return <main className="inventoryPrintPage"><div className="inventoryPrintSheet"><p>Формування друкованої форми…</p></div></main>;
  const {payload,snapshot}=data;
  const isDraft=payload.document.state==="draft";
  return <main className="inventoryPrintPage">
    <div className="inventoryPrintToolbar"><button onClick={()=>window.close()}>Закрити</button><button onClick={()=>window.print()}>Друкувати / PDF</button></div>
    <article className="inventoryPrintSheet">
      <header><div><small>{payload.organization.name}</small><h1>{TYPE_UK[payload.formType]}</h1><p>Документ {payload.document.number}</p></div><div><strong>{STATE_UK[payload.document.state]||payload.document.state}</strong>{isDraft&&<p>Не впливає на залишки до проведення</p>}</div></header>
      <section className="inventoryPrintMeta">
        <div><span>Номер</span><b>{payload.document.number}</b></div><div><span>Дата</span><b>{fmtDate(payload.document.occurredAt)}</b></div>
        <div><span>Створив</span><b>{payload.document.createdBy}</b></div><div><span>Стан</span><b>{STATE_UK[payload.document.state]||payload.document.state}</b></div>
        {payload.document.postedBy&&<><div><span>Провів</span><b>{payload.document.postedBy}</b></div><div><span>Проведено</span><b>{fmtDate(payload.document.postedAt)}</b></div></>}
      </section>
      {payload.document.comment&&<p><b>Примітка:</b> {payload.document.comment}</p>}
      <table><thead><tr><th>№</th><th>Матеріал</th><th>Партія / термін</th><th>Постачальник</th><th>Кількість</th><th>Підстава</th></tr></thead><tbody>
        {payload.lines.map(l=><tr key={l.lineNo}><td>{l.lineNo}</td><td><b>{l.itemName}</b></td><td>{l.lotNumber||"—"}{l.expiresOn?<><br/><small>до {l.expiresOn}</small></>:null}</td><td>{l.supplier||"—"}</td><td className="num">{fmt(l.quantity)} {l.unit}</td><td>{l.reason||"—"}{l.bookingId?<><br/><small>дослідження #{l.bookingId}</small></>:null}</td></tr>)}
      </tbody></table>
      <section className="inventoryPrintFooter"><div><span>Відповідальний</span><div className="inventoryPrintSignature"/></div><div><span>Підпис</span><div className="inventoryPrintSignature"/></div></section>
      <p className="inventoryPrintVersion">Форма v{snapshot.templateVersion} · snapshot #{snapshot.id} · SHA-256 {snapshot.sha256.slice(0,12)}…</p>
    </article>
  </main>;
}