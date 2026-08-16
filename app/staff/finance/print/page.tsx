"use client";

import { useEffect,useState } from "react";

type PrintPayload={
  templateVersion:number;
  formType:"payment_receipt";
  organization:{name:string};
  document:{id:number;number:string;documentType:"payment"|"refund";occurredAt:string;state:string;comment:string;createdBy:string;createdAt:string;postedBy:string;postedAt:string};
  booking:{id:number;code:string;patientName:string;patientId:string;service:string;serviceCode:string;patientCategory:string};
  payment:{amount:number;currency:string;method:string;provider:string;providerReference:string;transactionStatus:string};
  sourceDocument:null|{number:string;documentType:string};
};
type Snapshot={id:number;documentId:number;formType:string;templateVersion:number;documentState:string;generatedBy:string;generatedAt:string;storageKey:string;sha256:string};
type ResponsePayload={snapshot:Snapshot;payload:PrintPayload;error?:string};

const TYPE_UK={payment:"Квитанція про оплату",refund:"Квитанція про повернення"} as const;
const STATE_UK:Record<string,string>={draft:"ЧЕРНЕТКА",posted:"Проведено",reversed:"Сторновано",cancelled:"Скасовано"};
const METHOD_UK:Record<string,string>={cash:"Готівка",card:"Картка",bank_transfer:"Банківський переказ",privat_link:"Privat24",other:"Інше"};
function money(value:number,currency="UAH"){return new Intl.NumberFormat("uk-UA",{style:"currency",currency,maximumFractionDigits:0}).format(Number(value||0));}
function fmtDate(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString("uk-UA",{dateStyle:"medium",timeStyle:"short"});}

export default function FinancePrintPage(){
  const [data,setData]=useState<ResponsePayload|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      const id=Number(new URLSearchParams(window.location.search).get("id"));
      if(!Number.isInteger(id)||id<1){setError("Некоректний фінансовий документ");return;}
      void fetch("/api/staff/finance/print",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({documentId:id}),signal:controller.signal,
      }).then(async response=>{
        const payload=await response.json().catch(()=>({})) as ResponsePayload;
        if(!response.ok)throw new Error(payload.error||"Не вдалося сформувати квитанцію");
        setData(payload);
      }).catch(e=>{if(e?.name!=="AbortError")setError(e instanceof Error?e.message:"Помилка друку");});
    },0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[]);

  if(error)return <main className="financePrintPage"><div className="financePrintSheet"><h1>Не вдалося сформувати квитанцію</h1><p>{error}</p></div></main>;
  if(!data)return <main className="financePrintPage"><div className="financePrintSheet"><p>Формування квитанції…</p></div></main>;
  const {payload,snapshot}=data;
  const title=TYPE_UK[payload.document.documentType];
  const isRefund=payload.document.documentType==="refund";
  return <main className="financePrintPage">
    <div className="financePrintToolbar"><button onClick={()=>window.close()}>Закрити</button><button onClick={()=>window.print()}>Друкувати / PDF</button></div>
    <article className="financePrintSheet">
      <header><div><small>{payload.organization.name}</small><h1>{title}</h1><p>Документ {payload.document.number}</p></div><strong>{STATE_UK[payload.document.state]||payload.document.state}</strong></header>
      <section className="financePrintMeta">
        <div><span>Номер</span><b>{payload.document.number}</b></div><div><span>Дата</span><b>{fmtDate(payload.document.occurredAt)}</b></div>
        <div><span>Заявка</span><b>{payload.booking.code}</b></div><div><span>Пацієнт</span><b>{payload.booking.patientName}</b></div>
        <div><span>Послуга</span><b>{payload.booking.service}</b></div><div><span>Спосіб</span><b>{METHOD_UK[payload.payment.method]||payload.payment.method||payload.payment.provider||"—"}</b></div>
      </section>
      <section className={`financePrintAmount${isRefund?" refund":""}`}><span>{isRefund?"Повернено":"Отримано"}</span><b>{money(payload.payment.amount,payload.payment.currency)}</b></section>
      <section className="financePrintDetails">
        <p><span>Провайдер</span><b>{payload.payment.provider||"manual"}</b></p>
        <p><span>Платіжний референс</span><b>{payload.payment.providerReference||"—"}</b></p>
        {payload.sourceDocument&&<p><span>Документ-підстава</span><b>{payload.sourceDocument.number}</b></p>}
        {payload.document.comment&&<p><span>Примітка</span><b>{payload.document.comment}</b></p>}
      </section>
      <section className="financePrintFooter"><div><span>Відповідальний</span><b>{payload.document.postedBy||payload.document.createdBy}</b></div><div><span>Підпис</span><i/></div></section>
      <p className="financePrintVersion">Форма v{snapshot.templateVersion} · snapshot #{snapshot.id} · SHA-256 {snapshot.sha256.slice(0,12)}…</p>
    </article>
  </main>;
}
