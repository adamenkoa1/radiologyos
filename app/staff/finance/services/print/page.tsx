"use client";

import { useEffect,useState } from "react";

type PrintPayload={
  templateVersion:number;
  formType:"service_act";
  organization:{name:string};
  document:{id:number;number:string;occurredAt:string;state:string;comment:string;createdBy:string;createdAt:string;postedBy:string;postedAt:string};
  booking:{id:number;code:string;patientName:string;patientId:string;patientCategory:string};
  service:{
    code:string;title:string;equipmentId:string;durationMinutes:number;anatomicalRegionsCount:number;performedAt:string;
    radiologistEmail:string;radiographerEmail:string;priceAmount:number;chargeAmount:number;currency:string;
  };
};
type Snapshot={id:number;documentId:number;formType:string;templateVersion:number;documentState:string;generatedBy:string;generatedAt:string;storageKey:string;sha256:string};
type ResponsePayload={snapshot:Snapshot;payload:PrintPayload;error?:string};

const STATE_UK:Record<string,string>={posted:"Проведено",reversed:"СТОРНО",draft:"ЧЕРНЕТКА",cancelled:"Скасовано"};
function money(value:number,currency="UAH"){return new Intl.NumberFormat("uk-UA",{style:"currency",currency,maximumFractionDigits:0}).format(Number(value||0));}
function fmtDate(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString("uk-UA",{dateStyle:"medium",timeStyle:"short"});}

export default function ServiceActPrintPage(){
  const [data,setData]=useState<ResponsePayload|null>(null);
  const [error,setError]=useState("");

  useEffect(()=>{
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      const id=Number(new URLSearchParams(window.location.search).get("id"));
      if(!Number.isInteger(id)||id<1){setError("Некоректний документ надання послуги");return;}
      void fetch("/api/staff/service-deliveries/print",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({documentId:id}),signal:controller.signal,
      }).then(async response=>{
        const payload=await response.json().catch(()=>({})) as ResponsePayload;
        if(!response.ok)throw new Error(payload.error||"Не вдалося сформувати акт");
        setData(payload);
      }).catch(e=>{if(e?.name!=="AbortError")setError(e instanceof Error?e.message:"Помилка друку");});
    },0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[]);

  if(error)return <main className="financePrintPage"><div className="financePrintSheet"><h1>Не вдалося сформувати акт</h1><p>{error}</p></div></main>;
  if(!data)return <main className="financePrintPage"><div className="financePrintSheet"><p>Формування акта наданих послуг…</p></div></main>;

  const {payload,snapshot}=data;
  const paid=payload.service.chargeAmount>0;
  return <main className="financePrintPage">
    <div className="financePrintToolbar"><button onClick={()=>window.close()}>Закрити</button><button onClick={()=>window.print()}>Друкувати / PDF</button></div>
    <article className="financePrintSheet">
      <header>
        <div><small>{payload.organization.name}</small><h1>Акт наданих послуг</h1><p>Документ {payload.document.number}</p></div>
        <strong>{STATE_UK[payload.document.state]||payload.document.state}</strong>
      </header>

      <section className="financePrintMeta">
        <div><span>Номер</span><b>{payload.document.number}</b></div><div><span>Дата документа</span><b>{fmtDate(payload.document.occurredAt)}</b></div>
        <div><span>Заявка</span><b>{payload.booking.code}</b></div><div><span>Пацієнт</span><b>{payload.booking.patientName}</b></div>
        <div><span>Категорія</span><b>{payload.booking.patientCategory==="military"?"Військовослужбовець":"Цивільний"}</b></div>
        <div><span>Виконано</span><b>{fmtDate(payload.service.performedAt)}</b></div>
      </section>

      <section className="financePrintDetails">
        <p><span>Послуга</span><b>{payload.service.title}</b></p>
        <p><span>Код послуги</span><b>{payload.service.code}</b></p>
        <p><span>Апарат / кабінет</span><b>{payload.service.equipmentId}</b></p>
        <p><span>Тривалість</span><b>{payload.service.durationMinutes} хв</b></p>
        <p><span>Анатомічних ділянок</span><b>{payload.service.anatomicalRegionsCount}</b></p>
        <p><span>Лікар</span><b>{payload.service.radiologistEmail||"—"}</b></p>
        <p><span>Рентгенолаборант</span><b>{payload.service.radiographerEmail||"—"}</b></p>
      </section>

      <section className="financePrintAmount">
        <span>{paid?"Нараховано":"Умови надання"}</span>
        <b>{paid?money(payload.service.chargeAmount,payload.service.currency):"Безоплатно"}</b>
      </section>

      {payload.document.comment&&<section className="financePrintDetails"><p><span>Примітка</span><b>{payload.document.comment}</b></p></section>}

      <section className="financePrintFooter">
        <div><span>Відповідальний за проведення</span><b>{payload.document.postedBy||payload.document.createdBy}</b></div>
        <div><span>Підпис</span><i/></div>
      </section>
      <p className="financePrintVersion">Форма v{snapshot.templateVersion} · snapshot #{snapshot.id} · SHA-256 {snapshot.sha256.slice(0,12)}…</p>
    </article>
  </main>;
}
