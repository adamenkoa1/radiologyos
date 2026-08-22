"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { SERVICES } from "../../../lib/catalog";
import { SERVICE_CONFIG_DEFAULTS, type ServiceConfigRecord } from "../../../lib/service-config";
import { countUk, roleLabelUk } from "../../../lib/labels";

type StaffInfo = { email: string; displayName: string; role: string };
type MaterialRequirement = {
  id:number; serviceCode:string; serviceTitle:string; itemId:number; itemName:string; itemUnit:string;
  warehouseId:number; warehouseCode:string; warehouseName:string; quantity:number; active:number;
  createdBy:string; createdAt:string; updatedBy:string; updatedAt:string;
};
type InventoryItem = { id:number; name:string; unit:string; active:number };
type Warehouse = { id:number; code:string; name:string; active:number };
type InventoryPayload = { items?:InventoryItem[]; warehouses?:Warehouse[]; error?:string };
type RequirementPayload = { requirements?:MaterialRequirement[]; canEdit?:boolean; error?:string };

const CABINETS = {
  xray: "Кабінет цифрової рентгенографії",
  fluoro: "Кабінет цифрової флюорографії",
  ct: "Кабінет комп’ютерної томографії",
} as const;

function fmt(value:number){return Number(value||0).toLocaleString("uk-UA",{maximumFractionDigits:3});}

export default function ServiceAssignmentsPage() {
  const [services, setServices] = useState<ServiceConfigRecord[]>(SERVICE_CONFIG_DEFAULTS.map((row) => ({ ...row })));
  const [staff, setStaff] = useState<StaffInfo>();
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [requirements,setRequirements]=useState<MaterialRequirement[]>([]);
  const [inventoryItems,setInventoryItems]=useState<InventoryItem[]>([]);
  const [warehouses,setWarehouses]=useState<Warehouse[]>([]);
  const [materialCanEdit,setMaterialCanEdit]=useState(false);
  const [materialsLoaded,setMaterialsLoaded]=useState(false);
  const [materialError,setMaterialError]=useState("");
  const [materialNotice,setMaterialNotice]=useState("");
  const [materialBusy,setMaterialBusy]=useState(false);
  const [materialForm,setMaterialForm]=useState({serviceCode:"",itemId:"",warehouseId:"",quantity:"1"});

  useEffect(() => {
    let active = true;
    fetch("/api/staff/services", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) setError(data.error || "Не вдалося завантажити послуги");
        else {
          if (Array.isArray(data.services)) setServices(data.services);
          if (data.staff) setStaff(data.staff);
        }
        setLoaded(true);
      })
      .catch(() => { if (active) { setError("Не вдалося завантажити послуги — перевірте зʼєднання"); setLoaded(true); } });
    return () => { active = false; };
  }, []);

  useEffect(()=>{
    let active=true;
    Promise.all([
      fetch("/api/staff/service-material-requirements",{cache:"no-store"}),
      fetch("/api/staff/inventory",{cache:"no-store"}),
    ]).then(async([requirementsResponse,inventoryResponse])=>{
      const requirementData=await requirementsResponse.json().catch(()=>({})) as RequirementPayload;
      const inventoryData=await inventoryResponse.json().catch(()=>({})) as InventoryPayload;
      if(!active)return;
      if(!requirementsResponse.ok)throw new Error(requirementData.error||"Не вдалося завантажити норми матеріалів");
      if(!inventoryResponse.ok)throw new Error(inventoryData.error||"Не вдалося завантажити номенклатуру і склади");
      setRequirements(requirementData.requirements||[]);
      setMaterialCanEdit(Boolean(requirementData.canEdit));
      setInventoryItems(inventoryData.items||[]);
      setWarehouses(inventoryData.warehouses||[]);
      setMaterialError("");setMaterialsLoaded(true);
    }).catch((reason)=>{if(active){setMaterialError(reason instanceof Error?reason.message:"Не вдалося завантажити норми матеріалів");setMaterialsLoaded(true);}});
    return()=>{active=false;};
  },[]);

  const canEdit = staff?.role === "admin";

  const grouped = useMemo(() => Object.keys(CABINETS).map((equipmentId) => ({
    equipmentId,
    rows: services.filter((row) => row.equipmentId === equipmentId),
  })), [services]);
  const activeServices=useMemo(()=>services.filter(row=>row.active).map(row=>({code:row.code,title:SERVICES.find(service=>service.code===row.code)?.title||row.code})),[services]);
  const activeItems=useMemo(()=>inventoryItems.filter(row=>row.active),[inventoryItems]);
  const activeWarehouses=useMemo(()=>warehouses.filter(row=>row.active),[warehouses]);

  function change(code: string, field: keyof ServiceConfigRecord, value: string | boolean) {
    setServices((rows) => rows.map((row) => row.code === code
      ? ({ ...row, [field]: field === "durationMinutes" ? Number(value) : value } as ServiceConfigRecord)
      : row));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(""); setError("");
    const response = await fetch("/api/staff/services", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ services }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Не вдалося зберегти"); return; }
    if (Array.isArray(data.services)) setServices(data.services);
    setNotice("Прив’язки послуг збережено.");
  }

  async function createRequirement(event:FormEvent){
    event.preventDefault();
    if(!materialCanEdit||materialBusy)return;
    const itemId=Number(materialForm.itemId),warehouseId=Number(materialForm.warehouseId),quantity=Number(materialForm.quantity);
    if(!materialForm.serviceCode||!Number.isInteger(itemId)||itemId<1||!Number.isInteger(warehouseId)||warehouseId<1||!Number.isFinite(quantity)||quantity<=0){setMaterialError("Оберіть послугу, матеріал, склад і вкажіть додатну норму");return;}
    setMaterialBusy(true);setMaterialError("");setMaterialNotice("");
    try{
      const response=await fetch("/api/staff/service-material-requirements",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({serviceCode:materialForm.serviceCode,itemId,warehouseId,quantity}),
      });
      const payload=await response.json().catch(()=>({})) as {requirement?:MaterialRequirement;error?:string};
      if(!response.ok||!payload.requirement){setMaterialError(payload.error||"Не вдалося створити норму матеріалу");return;}
      const created=payload.requirement;
      setRequirements(current=>[...current,created].sort((a,b)=>`${a.serviceCode}-${1-a.active}-${a.id}`.localeCompare(`${b.serviceCode}-${1-b.active}-${b.id}`)));
      setMaterialForm(current=>({...current,itemId:"",quantity:"1"}));
      setMaterialNotice("Норму матеріалу додано. Вона застосовуватиметься до нової історії записів; наявні записи не перераховуються заднім числом.");
    }finally{setMaterialBusy(false);}
  }

  async function deactivateRequirement(row:MaterialRequirement){
    if(!materialCanEdit||materialBusy||!row.active)return;
    setMaterialBusy(true);setMaterialError("");setMaterialNotice("");
    try{
      const response=await fetch("/api/staff/service-material-requirements",{
        method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:row.id}),
      });
      const payload=await response.json().catch(()=>({})) as {requirement?:MaterialRequirement;error?:string};
      if(!response.ok||!payload.requirement){setMaterialError(payload.error||"Не вдалося вимкнути норму");return;}
      const updated=payload.requirement;
      setRequirements(current=>current.map(item=>item.id===updated.id?updated:item));
      setMaterialNotice("Норму вимкнено. Історичні резервації та рухи залишаються незмінними.");
    }finally{setMaterialBusy(false);}
  }

  return <StaffWorkspaceShell active="services" title="Послуги кабінетів" description="Кабінет, тривалість, доступність, правила запису та планові норми матеріалів для кожного дослідження." staffName={staff?.displayName} staffRole={roleLabelUk(staff?.role)}>
    {!loaded ? <p className="notice">Завантаження…</p> : <>
      <form className="equipmentRegistry" onSubmit={save}>
        <div className="equipmentRegistryHead">
          <div><b>Кабінет → обладнання → послуги</b><span>Неактивні послуги не приймаються сервером і не створюють слоти.</span></div>
          <a href="/staff/schedule">Графік кабінетів →</a>
        </div>
        <fieldset className="equipmentRegistryGrid" disabled={!canEdit}>
          {grouped.map((group, index) => <details className="equipmentCard" key={group.equipmentId} open={index === 0 && group.rows.length > 0}>
            <summary><i>{String(index + 1).padStart(2, "0")}</i><span><b>{CABINETS[group.equipmentId as keyof typeof CABINETS]}</b><small>{countUk(group.rows.length, "послуга", "послуги", "послуг")}</small></span><em className="active">Налаштування</em></summary>
            <div className="equipmentFields">
              {group.rows.length === 0 ? <p className="settingsHint">До цього кабінету не привʼязано жодної послуги.</p> : group.rows.map((row) => {
                const service = SERVICES.find((item) => item.code === row.code);
                if (!service) return null;
                return <div className="serviceAssignmentRow" key={row.code}>
                  <div><b>{row.code} · {service.title}</b><small>{service.group}</small></div>
                  <label style={{ gridColumn: "1 / -1" }}><span>Назва (публічна)</span><input type="text" maxLength={120} value={row.title || ""} placeholder={service.title} onChange={(event) => change(row.code, "title", event.target.value)} /></label>
                  <label style={{ gridColumn: "1 / -1" }}><span>Що входить (опис)</span><input type="text" maxLength={400} value={row.description || ""} placeholder={service.description} onChange={(event) => change(row.code, "description", event.target.value)} /></label>
                  <label><span>Кабінет</span><select value={row.equipmentId} onChange={(event) => change(row.code, "equipmentId", event.target.value)}>
                    {Object.entries(CABINETS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select></label>
                  <label><span>Тривалість, хв</span><input type="number" min={5} max={360} step={5} value={row.durationMinutes} onChange={(event) => change(row.code, "durationMinutes", event.target.value)} /></label>
                  <label><span>Стан</span><select value={row.active ? "active" : "inactive"} onChange={(event) => change(row.code, "active", event.target.value === "active")}><option value="active">Активна</option><option value="inactive">Вимкнена</option></select></label>
                  <label><span>Військовим</span><select value={row.military ? "yes" : "no"} onChange={(event) => change(row.code, "military", event.target.value === "yes")}><option value="yes">Доступна</option><option value="no">Недоступна</option></select></label>
                  <label><span>Цивільним</span><select value={row.civilian ? "yes" : "no"} onChange={(event) => change(row.code, "civilian", event.target.value === "yes")}><option value="yes">Доступна</option><option value="no">Недоступна</option></select></label>
                  <label><span>Попередній запис</span><select value={row.requiresBooking ? "yes" : "no"} onChange={(event) => change(row.code, "requiresBooking", event.target.value === "yes")}><option value="yes">Потрібен</option><option value="no">Жива черга</option></select></label>
                </div>;
              })}
            </div>
          </details>)}
        </fieldset>
        {error && <p className="notice error">{error}</p>}
        {notice && <p className="notice success">{notice}</p>}
        {canEdit ? <button className="equipmentSave" type="submit">Зберегти послуги</button> : <p className="settingsHint">Перегляд доступний персоналу; редагування — адміністратору.</p>}
      </form>

      <section className="equipmentRegistry" aria-label="Норми матеріалів за послугами">
        <div className="equipmentRegistryHead">
          <div><b>Послуга → матеріал → склад → планова норма</b><span>Норма створює лише планову резервацію для нових записів. Фактичне списання виконується окремо після завершення послуги.</span></div>
          <a href="/staff/inventory/material-consumption">Фактичне списання →</a>
        </div>
        {!materialsLoaded?<p className="notice">Завантаження норм матеріалів…</p>:<>
          {materialError&&<p className="notice error">{materialError}</p>}
          {materialNotice&&<p className="notice success">{materialNotice}</p>}
          {materialCanEdit&&<form className="inventoryOperations" onSubmit={createRequirement}><div>
            <label>Послуга<select required value={materialForm.serviceCode} onChange={event=>setMaterialForm(current=>({...current,serviceCode:event.target.value}))}><option value="">Оберіть послугу…</option>{activeServices.map(row=><option key={row.code} value={row.code}>{row.code} · {row.title}</option>)}</select></label>
            <label>Матеріал<select required value={materialForm.itemId} onChange={event=>setMaterialForm(current=>({...current,itemId:event.target.value}))}><option value="">Оберіть матеріал…</option>{activeItems.map(row=><option key={row.id} value={row.id}>{row.name} · {row.unit}</option>)}</select></label>
            <label>Склад<select required value={materialForm.warehouseId} onChange={event=>setMaterialForm(current=>({...current,warehouseId:event.target.value}))}><option value="">Оберіть склад…</option>{activeWarehouses.map(row=><option key={row.id} value={row.id}>{row.name} {row.code?`(${row.code})`:""}</option>)}</select></label>
            <label>Норма на 1 виконання<input required type="number" min="0.000001" max="1000000" step="any" value={materialForm.quantity} onChange={event=>setMaterialForm(current=>({...current,quantity:event.target.value}))}/></label>
            <button className="primary" disabled={materialBusy}>Додати норму</button>
          </div></form>}
          {!materialCanEdit&&<p className="settingsHint">Норми доступні для перегляду персоналу; створювати й вимикати їх може лише адміністратор.</p>}
          <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Послуга</th><th>Матеріал</th><th>Склад</th><th>Норма</th><th>Стан</th><th/></tr></thead><tbody>
            {requirements.map(row=><tr key={row.id}><td><b>{row.serviceTitle||row.serviceCode}</b><small>{row.serviceCode}</small></td><td>{row.itemName}<small>{row.itemUnit}</small></td><td>{row.warehouseName}<small>{row.warehouseCode}</small></td><td><b>{fmt(row.quantity)}</b> {row.itemUnit}</td><td><span className={`financeState ${row.active?"state-posted":"state-cancelled"}`}>{row.active?"Активна":"Вимкнена"}</span></td><td>{materialCanEdit&&row.active?<button type="button" disabled={materialBusy} onClick={()=>void deactivateRequirement(row)}>Вимкнути</button>:null}</td></tr>)}
            {requirements.length===0&&<tr><td colSpan={6}>Норм матеріалів ще немає.</td></tr>}
          </tbody></table></div>
        </>}
      </section>
    </>}
  </StaffWorkspaceShell>;
}