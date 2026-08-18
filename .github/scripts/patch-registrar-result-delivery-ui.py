from pathlib import Path

page = Path('app/staff/studies/page.tsx')
text = page.read_text(encoding='utf-8')

before = '''type SavedView = { id:number; name:string; config:{ filter:string; equipment:string } };
'''
after = '''type SavedView = { id:number; name:string; config:{ filter:string; equipment:string } };
type PendingDelivery = {
  kind:"protocol"|"addendum"; bookingId:number; bookingCode:string; patientName:string;
  serviceTitle:string; documentNumber:string; version:number; signedBy:string; signedAt:string;
  addendumId:string; baseProtocolVersion:number;
};
'''
assert text.count(before) == 1
text = text.replace(before, after, 1)

before = '''  const [contextStudy,setContextStudy] = useState<Study|null>(null);

  async function load() {
    const response = await fetch("/api/staff/studies", { cache:"no-store" });
    const payload = await response.json() as Data & { error?:string };
    if (!response.ok) { setError(payload.error || "Немає доступу"); return; }
    setData(payload);
    setStaff({ email:"", displayName:"", role:payload.role });
    setError("");
  }
'''
after = '''  const [contextStudy,setContextStudy] = useState<Study|null>(null);
  const [pendingDeliveries,setPendingDeliveries] = useState<PendingDelivery[]>([]);
  const [deliveryBusy,setDeliveryBusy] = useState("");

  async function load() {
    const [response,deliveryResponse] = await Promise.all([
      fetch("/api/staff/studies", { cache:"no-store" }),
      fetch("/api/staff/result-deliveries", { cache:"no-store" }),
    ]);
    const payload = await response.json() as Data & { error?:string };
    if (!response.ok) { setError(payload.error || "Немає доступу"); return; }
    setData(payload);
    setStaff({ email:"", displayName:"", role:payload.role });
    if (deliveryResponse.ok) {
      const deliveries = await deliveryResponse.json() as { pending?:PendingDelivery[] };
      setPendingDeliveries(deliveries.pending || []);
    } else {
      setPendingDeliveries([]);
    }
    setError("");
  }
'''
assert text.count(before) == 1
text = text.replace(before, after, 1)

before = '''  async function transition(id:number, status:string) {
'''
after = '''  async function deliverResult(item:PendingDelivery) {
    const key=item.kind === "protocol" ? `protocol:${item.bookingId}` : `addendum:${item.addendumId}`;
    setDeliveryBusy(key); setNotice("");
    try {
      const body=item.kind === "protocol"
        ? {kind:item.kind,bookingId:item.bookingId,version:item.version}
        : {kind:item.kind,addendumId:item.addendumId,version:item.version};
      const response=await fetch("/api/staff/result-deliveries",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
      });
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){setNotice(payload.error||"Не вдалося видати результат");return;}
      setNotice(item.kind === "protocol" ? "Протокол видано пацієнту." : "Виправлення до протоколу видано пацієнту.");
      await load();
    } catch {
      setNotice("Помилка мережі — не вдалося видати результат");
    } finally {
      setDeliveryBusy("");
    }
  }

  async function transition(id:number, status:string) {
'''
assert text.count(before) == 1
text = text.replace(before, after, 1)

before = '''    title="Реєстр досліджень"
    description="Усі дослідження організації з єдиним життєвим циклом: стан, обладнання, протокол і знімки в одному місці."
'''
after = '''    title="Видача результатів"
    description="Підписані протоколи й виправлення до видачі пацієнту; нижче — єдиний реєстр досліджень без змішування адміністративної видачі з клінічним редагуванням."
'''
assert text.count(before) == 1
text = text.replace(before, after, 1)

before = '''      {notice && <p className="staffError" role="status" onClick={()=>setNotice("")}>{notice}</p>}

      <div className="studiesToolbar" aria-label="Варіанти списку">
'''
after = '''      {notice && <p className="staffError" role="status" onClick={()=>setNotice("")}>{notice}</p>}

      {pendingDeliveries.length > 0 ? <section aria-labelledby="pending-deliveries-title">
        <div className="studiesOrgBar">
          <span className="studiesOrgBadge" id="pending-deliveries-title">До видачі</span>
          <small>{pendingDeliveries.length} підписаних документів · клінічний текст у цій черзі не відображається</small>
        </div>
        <div className="studiesTableWrap">
          <table className="studiesTable">
            <thead><tr>
              <th>Тип</th><th>Код</th><th>Пацієнт</th><th>Дослідження</th><th>Документ</th><th>Підписав</th><th>Підписано</th><th>Дія</th>
            </tr></thead>
            <tbody>{pendingDeliveries.map((item)=>{
              const key=item.kind === "protocol" ? `protocol:${item.bookingId}` : `addendum:${item.addendumId}`;
              return <tr key={key}>
                <td>{item.kind === "protocol" ? "Протокол" : "Виправлення"}</td>
                <td className="studiesCode">{item.bookingCode}</td>
                <td>{item.patientName || "—"}</td>
                <td>{item.serviceTitle || "—"}</td>
                <td>{item.documentNumber || "—"}{item.kind === "addendum" ? ` · v${item.version}` : ""}</td>
                <td>{item.signedBy || "—"}</td>
                <td>{item.signedAt || "—"}</td>
                <td><button type="button" className="button compact" disabled={deliveryBusy===key}
                  onClick={()=>void deliverResult(item)}>{deliveryBusy===key ? "Видаємо…" : "Видати пацієнту"}</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section> : null}

      <div className="studiesToolbar" aria-label="Варіанти списку">
'''
assert text.count(before) == 1
text = text.replace(before, after, 1)
page.write_text(text, encoding='utf-8')

roles = Path('docs/roles-permissions.md')
text = roles.read_text(encoding='utf-8')
before = '''- переглядати історію пацієнта в межах дозволу;
- переглядати власний графік змін read-only.
'''
after = '''- переглядати історію пацієнта в межах дозволу;
- видавати вже підписані результати для призначених йому досліджень;
- переглядати власний графік змін read-only.
'''
assert text.count(before) == 1
text = text.replace(before, after, 1)
before = '''- створювати картку пацієнта;
- переглядати власний графік змін read-only.

Не може редагувати підписаний протокол.
'''
after = '''- створювати картку пацієнта;
- бачити metadata-only чергу вже підписаних протоколів/виправлень і фіксувати їх видачу пацієнту;
- переглядати власний графік змін read-only.

Право видачі не дає доступу до клінічного тексту протоколу або виправлення, не дозволяє редагувати їх і не дозволяє підписувати лікарський висновок. Реєстратор бачить у черзі видачі лише адміністративні реквізити: код заявки, ПІБ, послугу, номер/версію документа, підписанта і час підпису.
'''
assert text.count(before) == 1
text = text.replace(before, after, 1)
roles.write_text(text, encoding='utf-8')

registrar = Path('docs/result-delivery-registrar.md')
text = registrar.read_text(encoding='utf-8')
before = '''Historical protocols that were already `issued` before 0092 are not backfilled. No retrospective delivery fact is invented.

## Immutable snapshot
'''
after = '''Historical protocols that were already `issued` before 0092 are not backfilled. No retrospective delivery fact is invented.

## Delivery authority

Clinical authoring and administrative delivery are separate capabilities. `canManageProtocols()` controls clinical protocol access/editing, while `canDeliverResults()` allows `admin`, `registrar`, and `radiologist` to perform only the already-signed `signed -> issued` transition. A radiologist remains assignment-scoped; registrar/admin delivery is tenant-scoped.

The dedicated `/api/staff/result-deliveries` queue deliberately returns only delivery metadata: booking code, patient name, service title, document number/version, signer and signature time. It never returns protocol findings/conclusion/sections or addendum reason/correction text. Granting a registrar delivery authority therefore does not grant clinical read/edit/sign authority.

The delivery endpoint does not create business evidence itself. It changes canonical clinical state only; migrations 0092/0094 remain the sole D1 owners of the atomic immutable `result_delivery` snapshots, so a failed registrar creation rejects the issuance transition.

## Immutable snapshot
'''
assert text.count(before) == 1
text = text.replace(before, after, 1)
registrar.write_text(text, encoding='utf-8')
