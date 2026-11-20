import React, { useEffect, useMemo, useState } from "react";
import { api } from "../data/api";
import type { Report, Run } from "../data/types";
import { go, useApp } from "../app/store";
import { Button, Card, Chip, EmptyState, ErrorState, Field, Loading, Metric, Modal, PageHead, SelectField, Spark, Stat, Tabs, fmtDate, fmtTime, pct } from "../ui/kit";
import { AirportMap, MapLayer, MapLegend } from "../map/AirportMap";
import { useSimulation } from "../map/useSimulation";
import { PlaybackControls, LiveMetricsCard, statusOf } from "./Lab";
import { HAZARD_LABELS, Modifiers, SimConfig, SimSummary } from "../sim/engine";
import { Candidate, EvaluatedCandidate, Scored, StressCase, Verdict, applicable, describeModifiers, mergeMods, safetyScore } from "../sim/analysis";
import { useAnalysis } from "../sim/client";
import { KIND, RunsTable } from "./Projects";
import { passwordIssues } from "./Auth";

/* ───────── shared helpers ───────── */
let chosenCandidate: string | null = null; // carried from «أنقذ الخطة» to «المقارنة»

function useActive() {
  const app = useApp();
  return { ...app, cfg: app.scenario, layout: app.layout };
}
function NeedProject({ title }: { title: string }) {
  return (
    <div className="page"><PageHead title={title} />
      <Card><EmptyState icon="▤" title="اختر مشروعًا أولًا" text="هذه الأداة تعمل على سيناريو المشروع النشط." action={<Button variant="go" onClick={() => go("projects")}>المشاريع</Button>} /></Card>
    </div>
  );
}
const zoneName = (layout: { zones: { id: string; name: string }[] }, id?: string) => layout.zones.find((z) => z.id === id)?.name ?? id ?? "";
export function scenarioLabel(cfg: SimConfig, layout: { zones: { id: string; name: string }[] }) {
  return cfg.hazard ? `${HAZARD_LABELS[cfg.hazard.type]} – ${zoneName(layout, cfg.hazard.zoneId)}` : "تمرين إخلاء بدون خطر";
}
const VERDICT: Record<Verdict, { t: string; tone: "green" | "yellow" | "red"; icon: string; long: string }> = {
  better: { t: "تحسّن", tone: "green", icon: "✓", long: "التحسين يقلّل زمن الإخلاء أو المخاطر في هذا السيناريو." },
  neutral: { t: "لا فرق جوهري", tone: "yellow", icon: "≈", long: "الفرق ضمن هامش التقلّب (أقل من 3٪) — لا يكفي لتبرير التغيير وحده." },
  worse: { t: "تراجع الأداء", tone: "red", icon: "✕", long: "التحسين أسوأ من الخطة الحالية في هذا السيناريو. لا يُنصح باعتماده." },
};
const scoreTone = (s: number) => (s >= 70 ? "green" : s >= 50 ? "yellow" : "red") as "green" | "yellow" | "red";

function Delta({ before, after, unit = "", lowerBetter = true, fmt = (v: number) => String(v) }: { before: number; after: number; unit?: string; lowerBetter?: boolean; fmt?(v: number): string }) {
  const d = after - before;
  if (Math.abs(d) < 1e-9) return <span className="delta-flat">— بلا تغيير</span>;
  const good = lowerBetter ? d < 0 : d > 0;
  return <span className={good ? "delta-good" : "delta-bad"}>{d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))}{unit}</span>;
}

function CompareTable({ a, b, la, lb }: { a: SimSummary; b: SimSummary; la: string; lb: string }) {
  const rows: [string, number, number, (v: number) => string, boolean][] = [
    ["زمن الإخلاء", a.evacTime ?? 900, b.evacTime ?? 900, fmtTime, true],
    ["اكتمال الإخلاء", a.completion, b.completion, pct, false],
    ["يتعذّر وصولهم", a.trapped, b.trapped, String, true],
    ["أعلى كثافة (شخص/م²)", a.peakDensity, b.peakDensity, (v) => v.toFixed(1), true],
    ["أقصى نقاط ازدحام", a.maxCongestionPoints, b.maxCongestionPoints, String, true],
    ["مؤشر السلامة", safetyScore(a), safetyScore(b), String, false],
  ];
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>المؤشر</th><th>{la}</th><th>{lb}</th><th>الفرق</th></tr></thead>
        <tbody>{rows.map(([k, x, y, f, low]) => (
          <tr key={k}><td>{k}</td><td className="num">{f(x)}</td><td className="num"><strong>{f(y)}</strong></td><td className="num"><Delta before={x} after={y} lowerBetter={low} fmt={f} /></td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Bars({ items, max, unit = "", fmt = (v: number) => String(v) }: { items: { label: string; value: number; color?: string }[]; max?: number; unit?: string; fmt?(v: number): string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="col" style={{ gap: 10 }}>
      {items.map((it) => (
        <div key={it.label} className="col" style={{ gap: 4 }}>
          <div className="row small" style={{ justifyContent: "space-between" }}><span className="secondary">{it.label}</span><span className="num">{fmt(it.value)}{unit}</span></div>
          <div className="bar"><i style={{ width: `${(it.value / m) * 100}%`, background: it.color ?? "var(--green)" }} /></div>
        </div>
      ))}
    </div>
  );
}

function Running({ text, sub }: { text: string; sub?: string }) {
  const [p, setP] = useState(4);
  useEffect(() => { const t = setInterval(() => setP((x) => Math.min(94, x + (100 - x) * 0.06)), 200); return () => clearInterval(t); }, []);
  return (
    <Card className="col" aria-live="polite">
      <div className="row"><span className="spinner" /><strong>{text}</strong></div>
      <div className="progress"><div style={{ width: `${p}%` }} /></div>
      {sub && <span className="small muted">{sub}</span>}
    </Card>
  );
}

/** Two synchronised simulations side by side with one set of controls. */
function DualRun({ a, b, onDone }: { a: { title: string; cfg: SimConfig }; b: { title: string; cfg: SimConfig }; onDone?(sa: SimSummary, sb: SimSummary): void }) {
  const { layout } = useApp();
  const A = useSimulation(a.cfg, layout), B = useSimulation(b.cfg, layout);
  const both = A.phase === "done" && B.phase === "done";
  useEffect(() => { if (both && A.sim && B.sim) onDone?.(A.sim.summary(), B.sim.summary()); }, [both]);
  const running = A.phase === "running" || B.phase === "running";
  const toggle = () => {
    if (running) { A.pause(); B.pause(); }
    else if (A.phase === "paused" || B.phase === "paused") { A.phase !== "done" && A.resume(); B.phase !== "done" && B.resume(); }
    else { A.start(); B.start(); }
  };
  const setSpeed = (x: number) => { A.setSpeed(x); B.setSpeed(x); };
  return (
    <div className="col">
      <div className="grid g2">
        {[[a, A], [b, B]].map(([x, s]: any, i) => (
          <Card key={i} className="col tight" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{x.title}</strong>
              <Chip tone={s.phase === "done" ? "green" : "gray"}>{s.metrics ? `${pct(s.metrics.completion)} · ${fmtTime(s.metrics.evacTime ?? Math.max(0, s.viewT - (s.sim?.alarmAt ?? 0)))}` : "—"}</Chip>
            </div>
            <AirportMap layout={layout} cfg={x.cfg} t={s.viewT} getAgents={s.getAgents} sim={s.sim} routes={s.routes} />
          </Card>
        ))}
      </div>
      <div className="controls">
        <Button variant={running ? "blue" : "go"} onClick={toggle} style={{ minWidth: 150 }}>{running ? "‖ إيقاف مؤقت" : both ? "↻ إعادة" : "▶ تشغيل متزامن"}</Button>
        <span className="num small">{fmtTime(Math.max(A.viewT, B.viewT))}</span>
        <div className="spacer" />
        {[1, 2, 4].map((x) => <button key={x} className={`speedbtn ${A.speed === x ? "active" : ""}`} onClick={() => setSpeed(x)}>{x}×</button>)}
        <button className="speedbtn" aria-label="تخطَّ إلى النتيجة" title="تخطَّ إلى النتيجة" onClick={() => { A.finish(); B.finish(); }}>⏭</button>
        <button className="speedbtn" aria-label="إعادة الضبط" onClick={() => { A.reset(); B.reset(); }}>■</button>
      </div>
    </div>
  );
}

async function saveRun(projectId: string, kind: Run["kind"], title: string, cfg: SimConfig, summary: SimSummary, meta?: Record<string, unknown>) {
  return api.createRun({ projectId, kind, title, config: cfg, summary, score: safetyScore(summary), meta });
}

/* ───────── 07 · Stress test (اكسر خطتي) ───────── */
export function Stress() {
  const { active, cfg, layout, setScenario, toast } = useActive();
  const an = useAnalysis<{ baseline: Scored; results: StressCase[]; worst: StressCase; breaking: StressCase[] }>();
  if (!active) return <NeedProject title="اكسر خطتي" />;
  const d = an.data;
  return (
    <div className="page">
      <PageHead crumbs={[["المحاكاة", "lab"], ["اكسر خطتي"]]} title="اكسر خطتي"
        actions={<Button variant="danger" loading={an.status === "running"} onClick={() => an.run("stress", cfg, layout)}>{d ? "إعادة الاختبار" : "ابدأ محاولة الكسر"}</Button>} />
      <Card className="row" style={{ justifyContent: "space-between" }}>
        <div><div className="small muted">الخطة المختبرة</div><strong>{active.name} · {cfg.passengers} مسافر · {cfg.exits} مخارج · {scenarioLabel(cfg, layout)}</strong></div>
        <span className="small muted" style={{ maxWidth: 420 }}>نجرّب {layout.zones.length * 4 + layout.exits.length + 2} سيناريو ضغط: حرائق وتسرّبات وإغلاقات في كل مساحة، إغلاق كل مخرج، زيادة الحشود وبطء الحركة.</span>
      </Card>
      {an.status === "idle" && <Card><EmptyState icon="⚡" title="ابحث عن نقطة الانكسار" text="سيُشغّل المحرّك جميع السيناريوهات ويرتّبها من الأسوأ إلى الأفضل." /></Card>}
      {an.status === "running" && <Running text="نختبر الخطة تحت الضغط…" sub="كل سيناريو محاكاة كاملة بنفس البذرة العشوائية لضمان عدالة المقارنة." />}
      {an.status === "error" && <ErrorState text={an.error!} retry={() => an.run("stress", cfg, layout)} />}
      {d && (
        <>
          <div className="grid g4">
            <Stat k="مؤشر الخطة الأساسية" v={d.baseline.score} sub={fmtTime(d.baseline.summary.evacTime)} />
            <Stat k="أسوأ مؤشر" v={<span className="delta-bad">{d.worst.score}</span>} sub={d.worst.title} />
            <Stat k="سيناريوهات تكسر الخطة" v={d.breaking.length} sub={`من ${d.results.length}`} />
            <Stat k="سيناريوهات بها عالقون" v={d.results.filter((r) => r.summary.trapped > 0).length} />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
            <Card className="col">
              <div className="card-head"><h2 className="h2">أسوأ حالة: {d.worst.title}</h2><Chip tone="red">مؤشر {d.worst.score}</Chip></div>
              <AirportMap layout={layout} cfg={d.worst.cfg} t={(d.worst.cfg.hazard?.at ?? 0) + 40} ariaLabel="خريطة أسوأ سيناريو" />
              <div className="grid g3">
                <Metric k="زمن الإخلاء" v={fmtTime(d.worst.summary.evacTime)} />
                <Metric k="يتعذّر وصولهم" v={d.worst.summary.trapped} tone={d.worst.summary.trapped ? "red" : undefined} />
                <Metric k="أعلى كثافة" v={d.worst.summary.peakDensity.toFixed(1)} />
              </div>
              <div className="row">
                <Button variant="go" onClick={() => { setScenario(d.worst.cfg); go("lab"); }}>شاهده في المختبر</Button>
                <Button variant="danger" onClick={() => { setScenario(d.worst.cfg); go("improve"); }}>أنقذ الخطة من هذه الحالة</Button>
                <Button onClick={async () => { await saveRun(active.id, "stress", `أسوأ حالة: ${d.worst.title}`, d.worst.cfg, d.worst.summary); toast("تم الحفظ", "ok"); }}>حفظ</Button>
              </div>
            </Card>
            <Card>
              <h2 className="h2" style={{ marginBottom: 12 }}>الترتيب من الأسوأ</h2>
              <div className="col" style={{ gap: 8, maxHeight: 560, overflow: "auto" }}>
                {d.results.slice(0, 16).map((r) => (
                  <button key={r.id} className="card clickable tight row" style={{ justifyContent: "space-between", padding: "10px 14px" }} onClick={() => { setScenario(r.cfg); go("lab"); }}>
                    <span className="small">{r.title}</span>
                    <span className="row" style={{ gap: 8 }}>
                      {r.summary.trapped > 0 && <Chip tone="red">{r.summary.trapped} عالق</Chip>}
                      <span className="num small muted">{fmtTime(r.summary.evacTime)}</span>
                      <Chip tone={scoreTone(r.score)}>{r.score}</Chip>
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────── 08 · Smart improvements (أنقذ الخطة) ───────── */
export function Improve() {
  const { active, cfg, layout, setScenario, toast } = useActive();
  const an = useAnalysis<{ baseline: Scored; candidates: EvaluatedCandidate[] }>();
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { if (active && an.status === "idle") an.run("improvements", cfg, layout); }, [active?.id]);
  if (!active) return <NeedProject title="أنقذ الخطة" />;
  const d = an.data;
  const c = d?.candidates.find((x) => x.id === sel) ?? null;
  return (
    <div className="page">
      <PageHead crumbs={[["المحاكاة", "lab"], ["أنقذ الخطة"]]} title={c ? "التحسين المختار" : an.status === "running" ? "تقييم التحسينات" : "أنقذ الخطة"}
        actions={<Button loading={an.status === "running"} onClick={() => { setSel(null); an.run("improvements", cfg, layout); }}>إعادة التقييم</Button>} />
      <Card className="small secondary">السيناريو: <strong>{scenarioLabel(cfg, layout)}</strong> · {cfg.passengers} مسافر · كل تحسين يُختبر بمحاكاة كاملة مقابل الخطة الحالية.</Card>
      {an.status === "running" && <Running text="نقيّم كل تحسين بمحاكاة مستقلة…" sub={`${applicable(layout).length} تحسينات مرشّحة`} />}
      {an.status === "error" && <ErrorState text={an.error!} retry={() => an.run("improvements", cfg, layout)} />}
      {d && !c && (
        <>
          <div className="grid g3">
            <Stat k="الخطة الحالية" v={fmtTime(d.baseline.summary.evacTime)} sub={`مؤشر السلامة ${d.baseline.score}`} />
            <Stat k="أفضل تحسين" v={<span className="delta-good">{fmtTime(d.candidates[0].summary.evacTime)}</span>} sub={d.candidates[0].title} />
            <Stat k="تحسينات مفيدة" v={d.candidates.filter((x) => x.verdict === "better").length} sub={`من ${d.candidates.length}`} />
          </div>
          <div className="col">
            {d.candidates.map((x, i) => (
              <button key={x.id} className="card clickable tight" onClick={() => setSel(x.id)}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="col" style={{ gap: 2 }}>
                    <strong className="h3">{i + 1}. {x.title}</strong>
                    <span className="small secondary">{x.detail}</span>
                    <span className="tiny muted">{x.requirement}</span>
                  </div>
                  <div className="row">
                    <span className="num small"><Delta before={d.baseline.summary.evacTime ?? 900} after={x.summary.evacTime ?? 900} fmt={(v) => `${Math.round(v)}`} unit=" ث" /></span>
                    <Chip tone={VERDICT[x.verdict].tone}>{VERDICT[x.verdict].icon} {VERDICT[x.verdict].t}</Chip>
                    <Chip tone={scoreTone(x.score)}>{x.score}</Chip>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      {d && c && (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
          <Card className="col">
            <div className="card-head"><h2 className="h2">{c.title}</h2><Chip tone={VERDICT[c.verdict].tone}>{VERDICT[c.verdict].t}</Chip></div>
            <AirportMap layout={layout} cfg={{ ...cfg, modifiers: mergeMods(cfg.modifiers, c.modifiers) }} t={(cfg.hazard?.at ?? 0) + 30} />
            <p className="small secondary">{c.detail} — {describeModifiers(c.modifiers).join("، ")}</p>
          </Card>
          <Card className="col">
            <CompareTable a={d.baseline.summary} b={c.summary} la="الحالية" lb="بعد التحسين" />
            <div className={`verdict ${c.verdict}`}><strong>{VERDICT[c.verdict].icon}</strong><span className="small">{VERDICT[c.verdict].long}</span></div>
            <div className="row">
              <Button variant="go" onClick={() => { chosenCandidate = c.id; go("compare"); }}>شاهد قبل / بعد</Button>
              <Button onClick={async () => { await saveRun(active.id, "improvement", c.title, { ...cfg, modifiers: mergeMods(cfg.modifiers, c.modifiers) }, c.summary); toast("تم حفظ نتيجة التحسين", "ok"); }}>حفظ النتيجة</Button>
              <Button variant="blue" onClick={() => { setScenario({ ...cfg, modifiers: mergeMods(cfg.modifiers, c.modifiers) }); toast("أُضيف التحسين إلى السيناريو", "ok"); go("lab"); }}>اعتماد في السيناريو</Button>
              <Button variant="ghost" onClick={() => setSel(null)}>كل التحسينات</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ───────── 09 · Before / After ───────── */
export function Compare() {
  const { active, cfg, layout } = useActive();
  const list = applicable(layout);
  const [cid, setCid] = useState<string>(chosenCandidate ?? list[0]?.id);
  const [res, setRes] = useState<[SimSummary, SimSummary] | null>(null);
  useEffect(() => setRes(null), [cid, JSON.stringify(cfg)]);
  if (!active) return <NeedProject title="المقارنة" />;
  const cand = list.find((c) => c.id === cid)!;
  const after = { ...cfg, modifiers: mergeMods(cfg.modifiers, cand.modifiers) };
  const v: Verdict | null = res ? verdictOf(res[0], res[1]) : null;
  return (
    <div className="page">
      <PageHead crumbs={[["المحاكاة", "lab"], ["المقارنة"]]} title="قبل التحسين / بعد التحسين"
        actions={<div style={{ minWidth: 260 }}><SelectField value={cid} onChange={setCid} options={list.map((c) => [c.id, c.title])} label="التحسين" /></div>} />
      <span className="small muted">{scenarioLabel(cfg, layout)} · نفس الأشخاص ونفس البذرة العشوائية في الجهتين — الفرق ناتج عن التحسين فقط.</span>
      <DualRun key={cid + JSON.stringify(cfg)} a={{ title: "قبل التحسين", cfg }} b={{ title: `بعد: ${cand.title}`, cfg: after }} onDone={(x, y) => setRes([x, y])} />
      {res && v ? (
        <>
          <div className={`verdict ${v}`}><strong className="h2">{VERDICT[v].icon}</strong><div><strong className="h3">{VERDICT[v].t}</strong><div className="small secondary">{VERDICT[v].long}</div></div></div>
          <Card><CompareTable a={res[0]} b={res[1]} la="قبل" lb="بعد" /></Card>
        </>
      ) : <Card className="small muted">شغّل المقارنة (أو ⏭ للنتيجة مباشرة) لعرض الفروق التفصيلية والحكم.</Card>}
    </div>
  );
}
function verdictOf(a: SimSummary, b: SimSummary): Verdict {
  const sa = { summary: a, score: safetyScore(a) }, sb = { summary: b, score: safetyScore(b) };
  const bt = a.evacTime ?? 900, at = b.evacTime ?? 900;
  if (b.trapped !== a.trapped) return b.trapped < a.trapped ? "better" : "worse";
  if (Math.abs((at - bt) / bt) < 0.03 && Math.abs(sb.score - sa.score) < 2) return "neutral";
  return at < bt || sb.score > sa.score ? "better" : "worse";
}

/* ───────── 10 · Human vs AI ───────── */
export function Challenge() {
  const { active, cfg, layout, toast } = useActive();
  const list = applicable(layout);
  const [step, setStep] = useState(0);
  const [mine, setMine] = useState<string[]>([]);
  const ai = useAnalysis<{ ids: string[]; mods: Modifiers; result: Scored; tried: number }>();
  const [res, setRes] = useState<[SimSummary, SimSummary] | null>(null);
  if (!active) return <NeedProject title="تحدّي الحلول" />;
  const myMods = mine.reduce<Modifiers>((m, id) => mergeMods(m, list.find((c) => c.id === id)!.modifiers), cfg.modifiers ?? {});
  const steps = ["السيناريو", "حلّك", "تأكيد التفسير", "الحل المنافس", "المحاكاة", "النتيجة"];
  const toggle = (id: string) => setMine((m) => (m.includes(id) ? m.filter((x) => x !== id) : m.length >= 2 ? m : [...m, id]));
  const win = res ? (safetyScore(res[0]) === safetyScore(res[1]) ? ((res[0].evacTime ?? 900) <= (res[1].evacTime ?? 900) ? "you" : "ai") : safetyScore(res[0]) > safetyScore(res[1]) ? "you" : "ai") : null;
  return (
    <div className="page">
      <PageHead crumbs={[["المحاكاة", "lab"], ["تحدّي الحلول"]]} title={`تحدّي الحلول — ${steps[step]}`} />
      <div className="stepper">{steps.map((s, i) => <div key={s} className={`st ${i < step ? "done" : i === step ? "cur" : ""}`}>{i < step ? "✓ " : `${i + 1}. `}{s}</div>)}</div>
      {step === 0 && (
        <Card className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
          <AirportMap layout={layout} cfg={cfg} t={(cfg.hazard?.at ?? 0) + 15} />
          <div className="col">
            <h2 className="h2">{scenarioLabel(cfg, layout)}</h2>
            <p className="secondary small">لديك تدخّلان كحد أقصى لتحسين الإخلاء. المنافس الآلي يجرّب كل التوليفات الممكنة من نفس القائمة ويختار الأفضل وفق مؤشر السلامة — بحث شامل شفّاف، وليس نموذج تعلّم آلي.</p>
            <Metric k="المسافرون / الموظفون" v={`${cfg.passengers} / ${cfg.staff}`} />
            <Metric k="المخارج المتاحة" v={cfg.exits} />
            <Button variant="primary" onClick={() => setStep(1)}>ابدأ التحدّي</Button>
          </div>
        </Card>
      )}
      {step === 1 && (
        <Card className="col">
          <h2 className="h2">اختر حتى تدخّلين</h2>
          <div className="grid g2">
            {list.map((c) => (
              <button key={c.id} className="card clickable tight" aria-pressed={mine.includes(c.id)} onClick={() => toggle(c.id)}
                style={mine.includes(c.id) ? { borderColor: "var(--green)", background: "var(--green-soft)" } : undefined}>
                <strong>{mine.includes(c.id) ? "✓ " : ""}{c.title}</strong><div className="small muted">{c.detail}</div>
              </button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}><span className="small muted">{mine.length}/2 مختار</span><Button variant="blue" disabled={!mine.length} onClick={() => setStep(2)}>التالي</Button></div>
        </Card>
      )}
      {step === 2 && (
        <Card className="col">
          <h2 className="h2">هكذا فهمنا حلّك</h2>
          <ul className="secondary">{describeModifiers(myMods).map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="small muted">سيُطبّق هذا على نفس السيناريو ونفس الأشخاص. هل التفسير صحيح؟</p>
          <div className="row"><Button variant="ghost" onClick={() => setStep(1)}>تعديل</Button><Button variant="go" onClick={() => { setStep(3); ai.run("ai", cfg, layout); }}>نعم، تأكيد</Button></div>
        </Card>
      )}
      {step === 3 && (ai.status === "running" ? <Running text="المنافس يبحث عن أفضل توليفة…" /> : ai.data && (
        <Card className="col">
          <h2 className="h2">الحل المنافس</h2>
          <p className="secondary">جرّب {ai.data.tried} توليفة واختار:</p>
          <ul>{ai.data.ids.map((id) => <li key={id}><strong>{list.find((c) => c.id === id)?.title}</strong> — <span className="small muted">{list.find((c) => c.id === id)?.detail}</span></li>)}</ul>
          <Button variant="primary" onClick={() => setStep(4)}>إلى المواجهة</Button>
        </Card>
      ))}
      {step >= 4 && ai.data && (
        <>
          <DualRun a={{ title: "حلّك", cfg: { ...cfg, modifiers: myMods } }} b={{ title: "الحل المنافس", cfg: { ...cfg, modifiers: ai.data.mods } }} onDone={(x, y) => { setRes([x, y]); setStep(5); }} />
          {res && (
            <Card className="col">
              <div className={`verdict ${win === "you" ? "better" : "worse"}`}><strong className="h2">{win === "you" ? "🏆" : "♟"}</strong><div><strong className="h3">{win === "you" ? "فاز حلّك!" : "تفوّق الحل المنافس"}</strong><div className="small secondary">مؤشر السلامة: أنت {safetyScore(res[0])} · المنافس {safetyScore(res[1])}</div></div></div>
              <CompareTable a={res[1]} b={res[0]} la="المنافس" lb="حلّك" />
              <div className="row">
                <Button onClick={async () => { await saveRun(active.id, "challenge", `تحدٍّ: ${win === "you" ? "فوز المستخدم" : "فوز المنافس"}`, { ...cfg, modifiers: myMods }, res[0]); toast("تم حفظ نتيجة التحدّي", "ok"); }}>حفظ النتيجة</Button>
                <Button variant="ghost" onClick={() => { setStep(1); setRes(null); setMine([]); }}>تحدٍّ جديد</Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* ───────── 11 · Solutions duel ───────── */
export function Duel() {
  const { active, cfg, layout } = useActive();
  const opts: { id: string; title: string; mods: Modifiers }[] = [{ id: "none", title: "الخطة الحالية", mods: {} }, ...applicable(layout).map((c: Candidate) => ({ id: c.id, title: c.title, mods: c.modifiers }))];
  const [a, setA] = useState("redistribute");
  const [b, setB] = useState("gate-doors");
  const [res, setRes] = useState<[SimSummary, SimSummary] | null>(null);
  useEffect(() => setRes(null), [a, b]);
  if (!active) return <NeedProject title="مواجهة الحلول" />;
  const A = opts.find((o) => o.id === a) ?? opts[0], B = opts.find((o) => o.id === b) ?? opts[1];
  const crit = res ? [
    ["الأسرع إخلاءً", (res[0].evacTime ?? 900) < (res[1].evacTime ?? 900) ? 0 : (res[0].evacTime ?? 900) > (res[1].evacTime ?? 900) ? 1 : -1],
    ["الأقل كثافة", res[0].peakDensity < res[1].peakDensity ? 0 : res[0].peakDensity > res[1].peakDensity ? 1 : -1],
    ["الأقل عالقين", res[0].trapped < res[1].trapped ? 0 : res[0].trapped > res[1].trapped ? 1 : -1],
    ["أعلى مؤشر سلامة", safetyScore(res[0]) > safetyScore(res[1]) ? 0 : safetyScore(res[0]) < safetyScore(res[1]) ? 1 : -1],
  ] as [string, number][] : [];
  return (
    <div className="page">
      <PageHead crumbs={[["المحاكاة", "lab"], ["مواجهة الحلول"]]} title="مواجهة الحلول"
        actions={<div className="row"><div style={{ width: 220 }}><SelectField label="الحل (أ)" value={a} onChange={setA} options={opts.map((o) => [o.id, o.title])} /></div><div style={{ width: 220 }}><SelectField label="الحل (ب)" value={b} onChange={setB} options={opts.map((o) => [o.id, o.title])} /></div></div>} />
      <DualRun key={a + b} a={{ title: `أ: ${A.title}`, cfg: { ...cfg, modifiers: mergeMods(cfg.modifiers, A.mods) } }} b={{ title: `ب: ${B.title}`, cfg: { ...cfg, modifiers: mergeMods(cfg.modifiers, B.mods) } }} onDone={(x, y) => setRes([x, y])} />
      {res && (
        <div className="grid g2">
          <Card className="col"><h2 className="h2">المعايير</h2>
            {crit.map(([k, w]) => <div key={k} className="row" style={{ justifyContent: "space-between" }}><span>{k}</span><Chip tone={w === -1 ? "yellow" : "green"}>{w === -1 ? "تعادل" : w === 0 ? `أ: ${A.title}` : `ب: ${B.title}`}</Chip></div>)}
          </Card>
          <Card><CompareTable a={res[0]} b={res[1]} la="أ" lb="ب" /></Card>
        </div>
      )}
    </div>
  );
}

/* ───────── 12 · Risk lens & replay ───────── */
export function Risk() {
  const { active, cfg, layout } = useActive();
  const s = useSimulation(cfg, layout);
  const [layer, setLayer] = useState<MapLayer>("all");
  const [heat, setHeat] = useState(true);
  useEffect(() => { if (s.phase === "idle" && s.sim) s.finish(); }, [s.version]);
  if (!active) return <NeedProject title="عدسة الخطر" />;
  const samples = s.sim?.samples ?? [];
  const moments: [string, number][] = [];
  if (cfg.hazard) moments.push(["بداية الخطر", cfg.hazard.at]);
  const firstCong = samples.find((x) => x.congestion > 0); if (firstCong) moments.push(["أول ازدحام", firstCong.t]);
  const half = samples.find((x) => x.completion >= 0.5); if (half) moments.push(["50٪ خرجوا", half.t]);
  const peak = samples.reduce((m, x) => (x.peakDensity > m.peakDensity ? x : m), samples[0] ?? { t: 0, peakDensity: 0 }); if (peak) moments.push(["ذروة الكثافة", peak.t]);
  if (s.sim?.done) moments.push(["النهاية", s.sim.t]);
  const st = statusOf(s);
  return (
    <div className="page">
      <PageHead crumbs={[["المحاكاة", "lab"], ["عدسة الخطر"]]} title="عدسة الخطر" status={<Chip tone={s.replay ? "yellow" : st.tone}>{s.replay ? "◀ وضع الإعادة" : st.text}</Chip>}
        actions={cfg.hazard ? <Button variant="danger" onClick={() => { s.seek(cfg.hazard!.at); s.resume(); }}>ارجع للحظة بداية الخطر</Button> : undefined} />
      <div className="lab" style={{ gridTemplateColumns: "240px minmax(0,1fr) 210px" }}>
        <Card className="col tight">
          <h2 className="h3">الطبقات</h2>
          <Tabs value={layer} onChange={setLayer} items={[["all", "الكل"], ["people", "الأشخاص"], ["routes", "المسارات"], ["hazards", "المخاطر"]]} />
          <label className="check"><input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} />خريطة الكثافة الحرارية</label>
          <h2 className="h3" style={{ marginTop: 12 }}>لحظات مفصلية</h2>
          {moments.map(([k, t]) => (
            <button key={k} className="card clickable tight row" style={{ justifyContent: "space-between", padding: "10px 12px" }} onClick={() => { s.seek(t); s.pause(); }}>
              <span className="small">{k}</span><span className="num small muted">{fmtTime(t)}</span>
            </button>
          ))}
          <span className="tiny muted">اختر لحظة لعرضها، ثم ▶ لمتابعة الإعادة.</span>
        </Card>
        <div className="col mapcol" style={{ gap: 10 }}>
          <AirportMap layout={layout} cfg={cfg} t={s.viewT} getAgents={s.getAgents} sim={s.sim} routes={s.routes} layer={layer} heat={heat} />
          <MapLegend />
          <PlaybackControls s={s} />
        </div>
        <div className="metrics"><LiveMetricsCard s={s} /></div>
      </div>
    </div>
  );
}

/* ───────── 13 · Robustness ───────── */
type Rob = { runs: { seed: number; passengers: number; speed: number; score: number; evacTime: number; trapped: number }[]; min: number; max: number; meanScore: number; sdScore: number; stable: boolean };
export function Robustness() {
  const { active, cfg, layout, toast } = useActive();
  const an = useAnalysis<Rob>();
  if (!active) return <NeedProject title="اختبار تحمّل تغيّر الظروف" />;
  const d = an.data;
  return (
    <div className="page">
      <PageHead crumbs={[["المحاكاة", "lab"], ["اختبار التحمّل"]]} title="اختبار تحمّل تغيّر الظروف"
        actions={<Button variant="go" loading={an.status === "running"} onClick={() => an.run("robustness", cfg, layout, 12)}>{d ? "إعادة الاختبار" : "تشغيل 12 تشغيلًا"}</Button>} />
      <Card className="small secondary">نعيد تشغيل <strong>{scenarioLabel(cfg, layout)}</strong> 12 مرة مع تغيير عدد المسافرين ±20٪ وسرعة الحركة ±15٪ وتوزيع الأشخاص. الخطة المتينة تحافظ على نتائج متقاربة.</Card>
      {an.status === "idle" && <Card><EmptyState icon="≋" title="هل تصمد خطتك أمام تغيّر الظروف؟" text="شغّل الاختبار لقياس تذبذب النتائج." /></Card>}
      {an.status === "running" && <Running text="نشغّل 12 محاكاة بظروف مختلفة…" />}
      {d && (
        <>
          <div className="grid g4">
            <Stat k="الحكم" v={<span className={d.stable ? "delta-good" : "delta-bad"}>{d.stable ? "متينة" : "حسّاسة"}</span>} sub={d.stable ? "تذبذب منخفض ولا عالقين" : "تتأثر بتغيّر الظروف"} />
            <Stat k="متوسط مؤشر السلامة" v={d.meanScore} sub={`± ${d.sdScore}`} />
            <Stat k="أسرع إخلاء" v={fmtTime(d.min)} />
            <Stat k="أبطأ إخلاء" v={fmtTime(d.max)} />
          </div>
          <Card className="col">
            <div className="card-head"><h2 className="h2">زمن الإخلاء لكل تشغيل</h2><Button size="sm" onClick={async () => {
              const best = d.runs.reduce((a, b) => (a.evacTime > b.evacTime ? a : b));
              await api.createRun({ projectId: active.id, kind: "robustness", title: `اختبار تحمّل – ${d.stable ? "متينة" : "حسّاسة"}`, config: cfg, summary: { evacTime: best.evacTime, completion: 1, evacuated: best.passengers, trapped: best.trapped, total: best.passengers, peakDensity: 0, maxCongestionPoints: 0, exitUsage: {}, alarmAt: cfg.hazard?.at ?? 0, endT: best.evacTime }, score: d.meanScore, meta: { sd: d.sdScore } });
              toast("تم الحفظ", "ok");
            }}>حفظ</Button></div>
            <Bars items={d.runs.map((r, i) => ({ label: `تشغيل ${i + 1} · ${r.passengers} مسافر · ${r.speed} م/ث`, value: r.evacTime, color: r.trapped ? "var(--red)" : r.evacTime > (d.min + d.max) / 2 ? "var(--yellow)" : "var(--green)" }))} fmt={(v) => fmtTime(v)} />
          </Card>
        </>
      )}
    </div>
  );
}

/* ───────── 14 · Analytics & history ───────── */
export function Analytics({ tab: initial = "results" }: { tab?: string }) {
  const { projects } = useApp();
  const [tab, setTab] = useState<"results" | "history">(initial === "history" ? "history" : "results");
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [kind, setKind] = useState("all");
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.listRuns().then(setRuns).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <ErrorState text={err} retry={load} />;
  if (!runs) return <Loading />;
  const chrono = [...runs].reverse();
  const sims = runs.filter((r) => r.kind !== "robustness");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const byHazard = new Map<string, number[]>();
  for (const r of sims) { const k = r.config.hazard ? HAZARD_LABELS[r.config.hazard.type] : "بدون خطر"; byHazard.set(k, [...(byHazard.get(k) ?? []), r.summary.evacTime ?? 900]); }
  const exitTotals: Record<string, number> = {};
  for (const r of sims) for (const [k, v] of Object.entries(r.summary.exitUsage)) exitTotals[k] = (exitTotals[k] ?? 0) + v;
  const totalOut = Object.values(exitTotals).reduce((a, b) => a + b, 0) || 1;
  const filtered = runs.filter((r) => kind === "all" || r.kind === kind);
  return (
    <div className="page">
      <PageHead crumbs={[["مساحة العمل", "dashboard"], ["النتائج والتحليلات"]]} title={tab === "results" ? "النتائج والتحليلات" : "سجل المحاكاة"} actions={<Tabs value={tab} onChange={setTab} items={[["results", "التحليلات"], ["history", "السجل"]]} />} />
      {runs.length === 0 ? <Card><EmptyState title="لا توجد نتائج بعد" text="احفظ نتائج المحاكاة لتظهر التحليلات." action={<Button variant="go" onClick={() => go("lab")}>فتح المختبر</Button>} /></Card> : tab === "results" ? (
        <>
          <div className="grid g4">
            <Stat k="نتائج محفوظة" v={runs.length} />
            <Stat k="متوسط زمن الإخلاء" v={fmtTime(avg(sims.map((r) => r.summary.evacTime ?? 900)))} />
            <Stat k="متوسط مؤشر السلامة" v={Math.round(avg(runs.map((r) => r.score)))} />
            <Stat k="نتائج بها عالقون" v={sims.filter((r) => r.summary.trapped > 0).length} />
          </div>
          <div className="grid g2">
            <Card><h2 className="h2" style={{ marginBottom: 10 }}>مؤشر السلامة عبر الزمن</h2><Spark data={chrono.map((r) => r.score)} max={100} color="var(--green)" height={160} labels={[fmtDate(chrono[0].createdAt), fmtDate(chrono[chrono.length - 1].createdAt)]} /></Card>
            <Card><h2 className="h2" style={{ marginBottom: 10 }}>متوسط زمن الإخلاء حسب نوع الخطر</h2>
              <Bars items={[...byHazard].map(([k, v]) => ({ label: `${k} (${v.length})`, value: Math.round(avg(v)), color: k === "بدون خطر" ? "var(--green)" : "var(--orange)" }))} fmt={(v) => fmtTime(v)} />
            </Card>
            <Card><h2 className="h2" style={{ marginBottom: 10 }}>توزيع استخدام المخارج</h2>
              <Bars items={Object.entries(exitTotals).map(([k, v]) => ({ label: k === "ME" ? "الدخول الرئيسي" : k, value: Math.round((v / totalOut) * 100), color: "var(--green)" }))} max={100} unit="٪" />
              <p className="small muted">اعتماد كبير على مخرج واحد يعني أن إغلاقه سيؤثر بشدة — جرّبه في «اكسر خطتي».</p>
            </Card>
            <Card><h2 className="h2" style={{ marginBottom: 10 }}>حسب المشروع</h2>
              <Bars items={projects.map((p) => { const rs = runs.filter((r) => r.projectId === p.id); return { label: `${p.name} (${rs.length})`, value: Math.round(avg(rs.map((r) => r.score))), color: "var(--blue)" }; })} max={100} />
            </Card>
          </div>
        </>
      ) : (
        <Card className="col">
          <div className="row"><div style={{ width: 220 }}><SelectField value={kind} onChange={setKind} label="النوع" options={[["all", "الكل"], ...Object.entries(KIND)] as [string, string][]} /></div><span className="small muted">{filtered.length} نتيجة</span></div>
          {filtered.length ? <RunsTable runs={filtered} projects={projects} /> : <EmptyState title="لا نتائج بهذا النوع" />}
        </Card>
      )}
    </div>
  );
}

/* ───────── 15 · Safety reports ───────── */
const DECISION: Record<string, [string, "green" | "yellow" | "red"]> = { approve: ["اعتماد الخطة", "green"], "approve-with-changes": ["اعتماد مع تعديلات", "yellow"], reject: ["إعادة التصميم", "red"] };

export function Reports() {
  const { projects, active, toast } = useApp();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ title: "", runIds: [] as string[], decision: "approve-with-changes", notes: "" });
  const load = () => Promise.all([api.listReports(), api.listRuns()]).then(([r, rr]) => { setReports(r); setRuns(rr); });
  useEffect(() => { load(); }, []);
  if (!reports) return <Loading />;
  const projRuns = runs.filter((r) => r.projectId === active?.id);
  return (
    <div className="page">
      <PageHead crumbs={[["مساحة العمل", "dashboard"], ["التقارير"]]} title="التقارير" actions={<Button variant="primary" disabled={!active} onClick={() => { setV({ title: `ملف قرار السلامة — ${active?.name}`, runIds: projRuns.slice(0, 3).map((r) => r.id), decision: "approve-with-changes", notes: "" }); setOpen(true); }}>+ ملف قرار جديد</Button>} />
      {reports.length === 0 ? <Card><EmptyState icon="▦" title="لا توجد تقارير" text="أنشئ ملف قرار سلامة يجمع نتائج المحاكاة والتوصيات." /></Card> : (
        <div className="grid g3">
          {reports.map((r) => (
            <button key={r.id} className="card clickable col" style={{ gap: 8 }} onClick={() => go("report", r.id)}>
              <Chip tone={DECISION[r.decision][1]}>{DECISION[r.decision][0]}</Chip>
              <strong className="h3">{r.title}</strong>
              <span className="small muted">{projects.find((p) => p.id === r.projectId)?.name} · {r.runIds.length} نتائج · {fmtDate(r.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
      {open && active && (
        <Modal title="ملف قرار سلامة جديد" onClose={() => setOpen(false)} actions={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button variant="primary" disabled={!v.runIds.length || v.title.trim().length < 3} onClick={async () => {
            const r = await api.createReport({ projectId: active.id, title: v.title.trim(), runIds: v.runIds, decision: v.decision, notes: v.notes });
            toast("تم إنشاء ملف القرار", "ok"); go("report", r.id);
          }}>إنشاء</Button>
        </>}>
          <Field label="العنوان" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          <div className="field"><label>النتائج المضمّنة</label>
            <div className="col" style={{ gap: 6, maxHeight: 200, overflow: "auto" }}>
              {projRuns.length ? projRuns.map((r) => (
                <label key={r.id} className="check"><input type="checkbox" checked={v.runIds.includes(r.id)} onChange={(e) => setV({ ...v, runIds: e.target.checked ? [...v.runIds, r.id] : v.runIds.filter((x) => x !== r.id) })} />{r.title} · <span className="num">{fmtTime(r.summary.evacTime)}</span></label>
              )) : <span className="small muted">لا توجد نتائج محفوظة لهذا المشروع.</span>}
            </div>
          </div>
          <SelectField label="القرار" value={v.decision} onChange={(d) => setV({ ...v, decision: d })} options={Object.entries(DECISION).map(([k, [l]]) => [k, l])} />
          <div className="field"><label htmlFor="notes">ملاحظات</label><textarea id="notes" className="input" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  );
}

export function ReportView({ id }: { id: string }) {
  const { projects, user, toast } = useApp();
  const [rep, setRep] = useState<Report | null | undefined>(undefined);
  const [runs, setRuns] = useState<Run[]>([]);
  useEffect(() => { Promise.all([api.listReports(), api.listRuns()]).then(([rs, rr]) => { setRep(rs.find((r) => r.id === id) ?? null); setRuns(rr); }); }, [id]);
  if (rep === undefined) return <Loading />;
  if (rep === null) return <ErrorState text="التقرير غير موجود" />;
  const p = projects.find((x) => x.id === rep.projectId);
  const rs = runs.filter((r) => rep.runIds.includes(r.id));
  const best = rs.reduce<Run | null>((a, b) => (!a || b.score > a.score ? b : a), null);
  const worst = rs.reduce<Run | null>((a, b) => (!a || b.score < a.score ? b : a), null);
  const summaryText = `${rep.title}\nالقرار: ${DECISION[rep.decision][0]}\n${rs.map((r) => `• ${r.title}: ${fmtTime(r.summary.evacTime)} — مؤشر ${r.score}`).join("\n")}\n${rep.notes ?? ""}\n(نتائج توضيحية لمنشأة خيالية)`;
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <PageHead crumbs={[["التقارير", "reports"], [rep.title]]} title="ملف قرار السلامة"
        actions={<>
          <Button onClick={() => navigator.clipboard?.writeText(summaryText).then(() => toast("تم نسخ الملخص", "ok"), () => toast("تعذّر النسخ", "bad"))}>نسخ الملخص</Button>
          <Button variant="danger" onClick={async () => { await api.deleteReport(rep.id); toast("تم حذف التقرير", "ok"); go("reports"); }}>حذف</Button>
        </>} />
      <Card className="col" style={{ gap: 24 }}>
        <div className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 16 }}>
          <div><div className="small muted">ملف قرار السلامة · {fmtDate(rep.createdAt)}</div><h2 className="h1">{rep.title}</h2><div className="secondary small">{p?.name} · أعدّه {user?.name}</div></div>
          <Chip tone={DECISION[rep.decision][1]}>{DECISION[rep.decision][0]}</Chip>
        </div>
        <div className="grid g3">
          <Stat k="سيناريوهات مختبرة" v={rs.length} />
          <Stat k="أفضل نتيجة" v={best ? fmtTime(best.summary.evacTime) : "—"} sub={best?.title} />
          <Stat k="أضعف نتيجة" v={worst ? worst.score : "—"} sub={worst?.title} />
        </div>
        <div><h3 className="h2" style={{ marginBottom: 8 }}>النتائج المضمّنة</h3>{rs.length ? <RunsTable runs={rs} /> : <span className="muted small">النتائج المرتبطة حُذفت.</span>}</div>
        {p && worst && <div><h3 className="h2" style={{ marginBottom: 8 }}>السيناريو الأكثر حرجًا</h3><AirportMap layout={p.layout} cfg={worst.config} t={(worst.config.hazard?.at ?? 0) + 35} /></div>}
        <div><h3 className="h2" style={{ marginBottom: 8 }}>التوصية والملاحظات</h3><p className="secondary">{rep.notes || "لا توجد ملاحظات."}</p></div>
        <div className="verdict neutral small">⚠ هذا الملف ناتج عن نموذج محاكاة توضيحي لمنشأة خيالية. لا يمثّل تقييمًا هندسيًا معتمدًا ولا يُستخدم لاتخاذ قرارات تشغيلية فعلية.</div>
      </Card>
    </div>
  );
}

/* ───────── 16 · Profile & account ───────── */
export function Profile() {
  const { user, setUser, toast } = useApp();
  const [v, setV] = useState({ name: user?.name ?? "", org: user?.org ?? "", role: user?.role ?? "" });
  const [pw, setPw] = useState({ cur: "", next: "" });
  const [out, setOut] = useState(false);
  const [del, setDel] = useState(false);
  const pwIssues = passwordIssues(pw.next);
  const dirty = v.name !== user?.name || v.org !== (user?.org ?? "") || v.role !== (user?.role ?? "");
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHead crumbs={[["الحساب"], ["الملف الشخصي"]]} title="الملف الشخصي" subtitle="حساب تجريبي — البيانات محفوظة في هذا المتصفح فقط." actions={<Button onClick={() => setOut(true)}>تسجيل الخروج</Button>} />
      <Card className="col">
        <div className="row"><div className="state ico" style={{ width: 64, height: 64, borderRadius: 20, display: "grid", placeItems: "center", background: "var(--elevated)", fontSize: 26, fontWeight: 800 }}>{user?.name?.[0]}</div><div><strong className="h2">{user?.name}</strong><div className="small muted" dir="ltr" style={{ textAlign: "right" }}>{user?.email}</div></div></div>
        <div className="grid g3">
          <Field label="الاسم" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={v.name.trim().length < 2 ? "مطلوب" : undefined} />
          <Field label="الجهة" value={v.org} onChange={(e) => setV({ ...v, org: e.target.value })} />
          <Field label="الدور" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} />
        </div>
        <div><Button variant="go" disabled={!dirty || v.name.trim().length < 2} onClick={async () => { setUser(await api.updateProfile(v)); toast("تم حفظ الملف الشخصي", "ok"); }}>حفظ التغييرات</Button></div>
      </Card>
      <Card className="col">
        <h2 className="h2">كلمة المرور</h2>
        <div className="grid g2">
          <Field label="الحالية" type="password" dir="ltr" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} />
          <Field label="الجديدة" type="password" dir="ltr" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} error={pw.next && pwIssues.length ? pwIssues.join("، ") : undefined} />
        </div>
        <div><Button disabled={!pw.cur || !pw.next || pwIssues.length > 0} onClick={async () => { await api.changePassword(pw.cur, pw.next); setPw({ cur: "", next: "" }); toast("تم تحديث كلمة المرور (عرض توضيحي)", "ok"); }}>تحديث كلمة المرور</Button></div>
      </Card>
      <Card className="row" style={{ justifyContent: "space-between", borderColor: "#8a2f4a" }}>
        <div><strong>إعادة ضبط البيانات التجريبية</strong><div className="small muted">يحذف الحساب والمشاريع والنتائج من هذا المتصفح.</div></div>
        <Button variant="danger" onClick={() => setDel(true)}>حذف الحساب</Button>
      </Card>
      {out && <Modal title="تأكيد تسجيل الخروج" onClose={() => setOut(false)} actions={<><Button variant="ghost" onClick={() => setOut(false)}>البقاء</Button><Button variant="primary" onClick={async () => { await api.logout(); setUser(null); go("welcome"); }}>تسجيل الخروج</Button></>}><p className="secondary">ستبقى مشاريعك محفوظة في هذا المتصفح عند عودتك بنفس البريد.</p></Modal>}
      {del && <Modal title="حذف الحساب والبيانات" onClose={() => setDel(false)} actions={<><Button variant="ghost" onClick={() => setDel(false)}>إلغاء</Button><Button variant="primary" onClick={async () => { await api.deleteAccount(); setUser(null); go("welcome"); }}>حذف نهائي</Button></>}><p className="secondary">سيتم حذف كل البيانات التجريبية من هذا المتصفح. لا يمكن التراجع.</p></Modal>}
    </div>
  );
}
