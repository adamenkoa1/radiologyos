"use client";

import { useCallback, useEffect, useState } from "react";
import StaffWorkspaceShell from "../../workspace-shell";
import { roleLabelUk } from "../../../../lib/labels";

type Severity = "error" | "warn" | "info";
type Issue = { rule: string; label: string; severity: Severity; path: string; detail: string };
type RuleMeta = { label: string; severity: Severity; help: string };
type Summary = {
  pages: number; score: number; errors: number; warns: number; infos: number;
  cleanPages: number;
  byRule: { rule: string; label: string; severity: Severity; count: number }[];
};
type PageRow = { path: string; title: string; titleLen: number; description: string; descLen: number; issues: number };
type Staff = { email: string; displayName: string; role: string };
type Payload = { summary: Summary; issues: Issue[]; pages: PageRow[]; rules: Record<string, RuleMeta> };

// Повні імена класів (не шаблон) — щоб їх бачив охоронець мертвого CSS.
const SEV_CLASS: Record<Severity, string> = { error: "sevError", warn: "sevWarn", info: "sevInfo" };
const SEV_LABEL: Record<Severity, string> = { error: "Помилка", warn: "Увага", info: "Порада" };
const scoreTone = (s: number) => (s >= 90 ? "scoreOk" : s >= 70 ? "scoreWarn" : "scoreAlert");

function ScoreRing({ score }: { score: number }) {
  const tone = score >= 90 ? "var(--status-ok-line)" : score >= 70 ? "var(--status-warn-line)" : "var(--status-alert-line)";
  return (
    <div className="seoScoreRing" style={{ background: `conic-gradient(${tone} ${score * 3.6}deg, var(--ws-line, #e4e7ec) 0)` }}>
      <span><b>{score}</b><small>/100</small></span>
    </div>
  );
}

export default function SeoReportPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/reports/seo", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || "Не вдалося завантажити аудит"); return; }
      setError(""); setData(body as Payload); setStaff(body.staff || null);
    } catch {
      setError("Мережа недоступна");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  const s = data?.summary;

  return <StaffWorkspaceShell
    active="reports"
    title="SEO-аудит сайту"
    description="Здоров'я публічних сторінок: title, опис, дублікати, локальні ключі та контент — за правилами docs/seo.md."
    staffName={staff?.displayName || staff?.email}
    staffRole={roleLabelUk(staff?.role)}
  >
    {error ? <section className="accessDenied"><b>Захищений розділ</b><p>{error}. Увійдіть через дозволений робочий обліковий запис.</p><a className="button compact" href="/staff/login?returnTo=%2Fstaff%2Freports%2Fseo">Увійти для роботи</a></section> :
    loading || !s || !data ? <section className="reportPanel"><p className="empty">Аналізуємо сторінки…</p></section> :
    <section className="seoDash">
      <div className="seoTop">
        <div className={`seoScoreCard ${scoreTone(s.score)}`}>
          <ScoreRing score={s.score} />
          <div>
            <span className="seoScoreLabel">Health-score</span>
            <b className="seoScoreVerdict">{s.score >= 90 ? "Здорово" : s.score >= 70 ? "Є що підтягнути" : "Потребує уваги"}</b>
            <small>{s.cleanPages} із {s.pages} сторінок без зауважень</small>
          </div>
        </div>
        <ul className="seoKpis">
          <li className="seoKpi sevError"><b>{s.errors}</b><span>Помилки</span></li>
          <li className="seoKpi sevWarn"><b>{s.warns}</b><span>Попередження</span></li>
          <li className="seoKpi sevInfo"><b>{s.infos}</b><span>Поради</span></li>
          <li className="seoKpi"><b>{s.pages}</b><span>Сторінок</span></li>
        </ul>
      </div>

      <div className="seoGrid">
        <article className="seoPanel">
          <header><b>Проблеми за типом</b><span>{s.byRule.length} категорій</span></header>
          {s.byRule.length === 0 ? <p className="empty">Жодної проблеми — усі правила виконано.</p> :
            <ul className="seoBreakdown">
              {s.byRule.map((r) => <li key={r.rule} className={SEV_CLASS[r.severity]}>
                <span className="seoBadge">{SEV_LABEL[r.severity]}</span>
                <span className="seoRuleLabel" title={data.rules[r.rule]?.help}>{r.label}</span>
                <b>{r.count}</b>
              </li>)}
            </ul>}
        </article>

        <article className="seoPanel">
          <header><b>Сторінки</b><span>найгостріші першими</span></header>
          <div className="reportTableScroll">
            <table className="seoPagesTable">
              <thead><tr><th>Шлях</th><th>Title</th><th>Опис</th><th>Проблем</th></tr></thead>
              <tbody>
                {data.pages.map((p) => <tr key={p.path} className={p.issues ? "hasIssues" : ""}>
                  <td className="seoPath">{p.path}</td>
                  <td className="seoLen"><span className={p.titleLen < 15 || p.titleLen > 60 ? "outOfRange" : ""}>{p.titleLen}</span></td>
                  <td className="seoLen"><span className={p.descLen < 70 || p.descLen > 160 ? "outOfRange" : ""}>{p.descLen}</span></td>
                  <td className="num"><b>{p.issues || "—"}</b></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <article className="seoPanel">
        <header><b>Список зауважень</b><span>{data.issues.length}</span></header>
        {data.issues.length === 0 ? <p className="empty">Зауважень немає.</p> :
          <ul className="seoIssueList">
            {data.issues.map((i, idx) => <li key={idx} className={SEV_CLASS[i.severity]}>
              <span className="seoBadge">{SEV_LABEL[i.severity]}</span>
              <span className="seoIssuePath">{i.path}</span>
              <span className="seoIssueLabel">{i.label}</span>
              <small>{i.detail}</small>
            </li>)}
          </ul>}
      </article>

      <div className="seoActions">
        <a className="button compact" href="/staff/reports">← До звітів</a>
        <button type="button" className="button" onClick={() => { setLoading(true); void load(); }}>Оновити</button>
      </div>
    </section>}
  </StaffWorkspaceShell>;
}
