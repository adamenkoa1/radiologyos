"use client";

import { useEffect, useState } from "react";
import StaffWorkspaceShell from "../workspace-shell";
import { DEPARTMENT_STRUCTURE as S } from "../../../lib/department-structure";

export default function StructurePage() {
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    // Гейт доступу: сторінка лише для персоналу (org-profile 403 для чужих).
    fetch("/api/staff/org-profile", { cache: "no-store" })
      .then((r) => { if (!active) return; if (r.status === 401 || r.status === 403) setForbidden(true); setLoaded(true); })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const body = forbidden
    ? <section className="accessDenied"><b>Захищений розділ</b><p>Структура відділення доступна лише персоналу.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Fstructure">Увійти для роботи</a></section>
    : !loaded
      ? <p className="dashLoading">Завантаження…</p>
      : <div className="structTree">
          <section className="structNode structHospital">
            <span className="structTag">Госпіталь</span>
            <h2>{S.hospital.name}</h2>
            <p>{S.hospital.unit} · ЄДРПОУ {S.hospital.edrpou}</p>
            <p className="structAddr">{S.hospital.address}</p>
          </section>

          <section className="structNode structLicense">
            <span className="structTag">Ліцензія</span>
            <h3>{S.license.number} <small>({S.license.series})</small></h3>
            <p>{S.license.activity}</p>
            <dl className="structMeta">
              <div><dt>Орган</dt><dd>{S.license.authority}</dd></div>
              <div><dt>Видана</dt><dd>{S.license.issued}</dd></div>
              <div><dt>Дійсна до</dt><dd className="structAccent">{S.license.validUntil}</dd></div>
              <div><dt>Зміни</dt><dd>{S.license.changes}</dd></div>
            </dl>
          </section>

          <section className="structNode structDept">
            <span className="structTag">Відділення</span>
            <h3>{S.department.name}</h3>
            <p className="structEmergency">🕓 {S.department.emergency}</p>
          </section>

          <section className="structNode">
            <span className="structTag">Кабінети й обладнання</span>
            <div className="structRooms">
              {S.rooms.map((room) => (
                <article className="structRoom" key={room.id}>
                  <h4>{room.name}<span className="structCount">{room.devices.length}</span></h4>
                  <ul>
                    {room.devices.map((d, i) => (
                      <li key={i}>
                        <b>{d.name}</b>
                        <span className="structDevMeta"><span className={`structKind k-${room.id}`}>{d.kind}</span>{d.kv}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="structNode">
            <span className="structTag">Персонал (штат)</span>
            <p className="structHint">Лише посади. Облікові записи реальних працівників — у розділі «Доступ персоналу» (/staff).</p>
            <ul className="structStaff">
              {S.personnel.map((p, i) => (
                <li key={i}><b>{p.position}</b>{p.note ? <small>{p.note}</small> : null}</li>
              ))}
            </ul>
          </section>

          <section className="structNode">
            <span className="structTag">Режим роботи</span>
            <div className="structHours">
              {[S.hours.outpatient, S.hours.inpatient].map((block, bi) => (
                <article key={bi}>
                  <h4>{block.title}</h4>
                  <table>
                    <tbody>
                      {block.rows.map((r, i) => (
                        <tr key={i}>
                          <th>{r.service}</th>
                          <td>{r.intake}{r.issue ? <small>{r.issue}</small> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </article>
              ))}
            </div>
            <p className="structEmergency">🕓 {S.department.emergency}</p>
          </section>
        </div>;

  return (
    <StaffWorkspaceShell
      active="structure"
      title="Структура відділення"
      description="Госпіталь, ліцензія, кабінети, обладнання, штат і режим роботи — в одному місці."
    >
      {body}
    </StaffWorkspaceShell>
  );
}
