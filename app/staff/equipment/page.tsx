"use client";

import { FormEvent, useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { EQUIPMENT_REGISTRY_DEFAULTS, type EquipmentRecord } from "../../../lib/equipment-registry";
import { countUk, roleLabelUk } from "../../../lib/labels";

type StaffInfo={email:string;displayName:string;role:string};
const STATUS_LABELS={active:"Працює",maintenance:"На обслуговуванні",inactive:"Не використовується"};

export default function EquipmentRegistryPage(){
  const [equipment,setEquipment]=useState<EquipmentRecord[]>(EQUIPMENT_REGISTRY_DEFAULTS.map(row=>({...row})));
  const [staff,setStaff]=useState<StaffInfo|null>(null);
  const [loaded,setLoaded]=useState(false); const [notice,setNotice]=useState(""); const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    const t=window.setTimeout(async()=>{
      try{
        const res=await fetch("/api/staff/equipment-registry",{cache:"no-store"});
        const data=await res.json().catch(()=>({})) as {equipment?:EquipmentRecord[];staff?:StaffInfo;error?:string};
        if(!active)return;
        if(!res.ok){setError(data.error||"Не вдалося завантажити обладнання");setLoaded(true);return;}
        if(data.equipment)setEquipment(data.equipment);
        if(data.staff)setStaff(data.staff);
      }catch{
        if(active)setError("Не вдалося завантажити обладнання — перевірте зʼєднання");
      }finally{
        if(active)setLoaded(true);
      }
    },0);
    return()=>{active=false;window.clearTimeout(t)};
  },[]);
  const canEdit=staff?.role==="admin";
  function change(id:EquipmentRecord["id"],field:keyof EquipmentRecord,value:string){setEquipment(rows=>rows.map(row=>row.id===id?{...row,[field]:value}:row));}
  async function save(event:FormEvent){event.preventDefault();setNotice("");setError("");const res=await fetch("/api/staff/equipment-registry",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({equipment})});const data=await res.json().catch(()=>({})) as {ok?:boolean;equipment?:EquipmentRecord[];error?:string};if(!res.ok){setError(data.error||"Не вдалося зберегти");return;}if(data.equipment)setEquipment(data.equipment);setNotice("Реєстр обладнання збережено.");}
  return <StaffWorkspaceShell active="equipment" title="Обладнання" description="Окремий реєстр апаратів, які зараз використовує відділення." staffName={staff?.displayName} staffRole={roleLabelUk(staff?.role)}>
    {!loaded?<p className="notice">Завантаження…</p>:error&&!staff?<p className="notice error">{error}</p>:<form className="equipmentRegistry" onSubmit={save}>
      <div className="equipmentRegistryHead"><div><b>Реєстр обладнання</b><span>{countUk(equipment.filter(row=>row.status==="active").length,"апарат","апарати","апаратів")} у роботі · характеристики можна доповнювати</span></div><div><a href="/staff/maintenance">ТО та несправності →</a><a href="/staff/schedule">Графік кабінетів →</a></div></div>
      <fieldset className="equipmentRegistryGrid" disabled={!canEdit}>{equipment.map((row,index)=><details className="equipmentCard" key={row.id} open={index===0}>
        <summary><i>{String(index+1).padStart(2,"0")}</i><span><b>{[row.manufacturer,row.model].filter(Boolean).join(" ")||row.type}</b><small>{row.type} · {row.room}</small></span><em className={row.status}>{STATUS_LABELS[row.status]}</em></summary>
        <div className="equipmentFields">
          <label className="wide"><span>Назва обладнання</span><input value={row.type} onChange={e=>change(row.id,"type",e.target.value)}/></label>
          <label><span>Виробник</span><input value={row.manufacturer} placeholder="Siemens" onChange={e=>change(row.id,"manufacturer",e.target.value)}/></label>
          <label><span>Модель</span><input value={row.model} placeholder="Уточніть модель" onChange={e=>change(row.id,"model",e.target.value)}/></label>
          <label><span>Кабінет</span><input value={row.room} onChange={e=>change(row.id,"room",e.target.value)}/></label>
          <label><span>Макс. напруга, кВ</span><input inputMode="numeric" value={row.maxKv} placeholder="кВ" onChange={e=>change(row.id,"maxKv",e.target.value)}/></label>
          <label><span>Рік випуску</span><input inputMode="numeric" maxLength={4} value={row.year} placeholder="РРРР" onChange={e=>change(row.id,"year",e.target.value)}/></label>
          <label><span>Серійний номер</span><input value={row.serialNumber} onChange={e=>change(row.id,"serialNumber",e.target.value)}/></label>
          <label><span>Стан</span><select value={row.status} onChange={e=>change(row.id,"status",e.target.value)}>{Object.entries(STATUS_LABELS).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
          <label className="wide"><span>Примітка</span><textarea value={row.notes} placeholder="Особливості роботи, комплектація…" onChange={e=>change(row.id,"notes",e.target.value)}/></label>
        </div>
      </details>)}</fieldset>
      {notice&&<p className="notice success">{notice}</p>}{error&&<p className="notice error">{error}</p>}
      {canEdit?<button className="equipmentSave" type="submit">Зберегти обладнання</button>:<p className="settingsHint">Перегляд доступний персоналу; редагування — адміністратору.</p>}
    </form>}
  </StaffWorkspaceShell>;
}
