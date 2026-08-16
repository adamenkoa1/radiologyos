"use client";

import { useEffect,useState } from "react";

type PrintPayload={
  templateVersion:number;
  formType:"service_act";
  organization:{name:string};
  document:{id:number;number:string;documentType:"service_delivery";occurredAt:string;state:string;createdBy:string;postedBy:string;postedAt:string};
  booking:{id:number;code:string;patientName:string;patientId:string;patientCategory:string};
  service:{code:string;name:string;chargeAmount:number;currency:string};
  execution:{equipmentId:string;durationMinutes:number;performedAt:string;anatomicalRegionsCount:number;radiologistEmail:string;radiographerEmail:string};
};
type Snapshot={id:number;documentId:number;formType:string;templateVersion:number;documentState:string;generatedBy:string;generatedAt:string;storageKey:string;sha256:string};
type ResponsePayload={snapshot:Snapshot;payload:PrintPayload;error?:string};

function money(value:number,currency="UAH"){
  return new Intl.NumberFormat("uk-UA",{style:"currency",currency,maximumFractionDigits:0}).format(Number(value||0));
}
function fmtDate(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString("uk-UA",{dateStyle:"medium",timeStyle:"short"});}

export default function ServiceDeliveryPrintPage(){
  const [data,setData]=useState<ResponsePayload|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      const id=Number(new URLSearchParams(window.location.search).get("id"));
      if(!Number.isInteger(id)||id<1){setError("Некоректний Акт");return;}
      void fetch("/api/staff/service-delivery/print",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({documentId:id}),signal:controller.signal,
      }).then(async response=>{
        const payload=await response.json().catch(()=>({})) as ResponsePayload;
        if(!response.ok)throw new Error(payload.error||"Не вдалося сформувати Акт");
        setData(payload);
      }).catch(e=>{if(e?.name!=="AbortError")setError(e instanceof Error?e.message:"Помилка друку");});
    },0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[]);

  if(error)return <main className="financePrintPage"><div className="financePrintSheet"><h1>Не вдалося сформувати Акт</h1><p>{error}</p></div></main>;
  if(!data)return <main className="financePrintPage"><div className="financePrintSheet"><p>Формування Акта…</p></div></main>;
  const {payload,snapshot}=data;
  const free=payload.service.chargeAmount===0;
  return <main className="financePrintPage">
    <div className="financePrintToolbar"><button onClick={()=>window.close()}>Закрити</button><button onClick={()=>window.print()}>Друкувати / PDF</button></div>
    <article className="financePrintSheet">
      <header><div><small>{payload.organization.name}</small><h1>Акт надання послуг</h1><p>Документ {payload.document.number}</p></div><strong>Проведено</strong></header>
      <section className="financePrintMeta">
        <div><span>Номер</span><b>{payload.document.number}</b></div><div><span>Дата виконання</span><b>{fmtDate(payload.execution.performedAt)}</b></div>
        <div><span>Заявка</span><b>{payload.booking.code}</b></div><div><span>Пацієнт</span><b>{payload.booking.patientName}</b></div>
        <div><span>Категорія</span><b>{payload.booking.patientCategory==="military"?"Військовий":"Цивільний"}</b></div><div><span>Апарат</span><b>{payload.execution.equipmentId}</b></div>
      </section>
      <section className="financePrintDetails">
        <p><span>Надана послуга</span><b>{payload.service.name}</b></p>
        <p><span>Код послуги</span><b>{payload.service.code}</b></p>
        <p><span>Анатомічних зон</span><b>{payload.execution.anatomicalRegionsCount}</b></p>
        <p><span>Тривалість</span><b>{payload.execution.durationMinutes} хв</b></p>
        <p><span>Лікар-рентгенолог</span><b>{payload.execution.radiologistEmail||"—"}</b></p>
        <p><span>Рентгенолаборант</span><b>{payload.execution.radiographerEmail||"—"}</b></p>
      </section>
      <section className="financePrintAmount"><span>{free?"Вартість для пацієнта":"Вартість послуги"}</span><b>{free?"Безоплатно":money(payload.service.chargeAmount,payload.service.currency)}</b></section>
      <section className="financePrintFooter"><div><span>Провів документ</span><b>{payload.document.postedBy||payload.document.createdBy}</b></div><div><span>Підпис</span><i/></div></section>
      <p className="financePrintVersion">Форма v{snapshot.templateVersion} · snapshot #{snapshot.id} · SHA-256 {snapshot.sha256.slice(0,12)}…</p>
    </article>
  </main>;
}
