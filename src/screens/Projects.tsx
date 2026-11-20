import React, { useEffect, useState } from "react";
import { api } from "../data/api";
import type { FacilityType, Project, Run } from "../data/types";
import { go, useApp } from "../app/store";
import { Button, Card, Chip, EmptyState, ErrorState, Field, Loading, Modal, PageHead, Stat, fmtDate, fmtTime } from "../ui/kit";
import { AirportMap } from "../map/AirportMap";
import { DEFAULT_CONFIG, HAZARD_LABELS } from "../sim/engine";
import { DEFAULT_LAYOUT } from "../sim/layout";

export const FACILITY: Record<FacilityType, string> = { terminal: "مبنى ركاب", training: "صالة تدريب", hall: "صالة وصول / مغادرة" };

export function sampleProject(name = "مطار سَبّاق الافتراضي") {
  return {
    name,
    description: "مبنى ركاب خيالي بأربع بوابات وبهو رئيسي وخمس مناطق خدمة.",
    facility: "terminal" as const,
    source: "builtin" as const,
    layout: DEFAULT_LAYOUT,
    config: { ...DEFAULT_CONFIG, passengers: 800, exits: 2, emergencyExits: 0, hazard: { type: "fire" as const, zoneId: "G04", at: 30 } },
    status: "ready" as const,
  };
}

export function ProjectThumb({ p }: { p: Project }) {
  return <AirportMap layout={p.layout} cfg={{ ...p.config, hazard: null }} t={0} compact ariaLabel={`مخطط ${p.name}`} />;
}

export function Dashboard() {
  const { user, projects, refreshProjects, setActiveId, toast } = useApp();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [reports, setReports] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    setErr(null);
    Promise.all([api.listRuns(), api.listReports()]).then(([r, rep]) => { setRuns(r); setReports(rep.length); }).catch((e) => setErr(e.message));
  };
  useEffect(load, []);
  const createSample = async () => {
    setBusy(true);
    try {
      const p = await api.createProject(sampleProject());
      await refreshProjects(); setActiveId(p.id); toast("تم إنشاء المشروع النموذجي", "ok"); go("lab");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  if (err) return <ErrorState text={err} retry={load} />;
  if (!runs) return <Loading />;
  const sims = runs.filter((r) => r.kind === "simulation").length;
  const improvements = runs.filter((r) => r.kind === "improvement").length;
  const empty = projects.length === 0;
  return (
    <div className="page">
      <PageHead crumbs={[["مساحة العمل"], ["لوحة التحكم"]]} title="لوحة التحكم"
        actions={<Button variant="primary" onClick={() => go("project-new")}>+ إنشاء مشروع جديد</Button>} />
      <div>
        <h2 className="h2">أهلًا، {user?.name}. {empty ? "لنبدأ أول اختبار." : "اختبر قرارك التالي."}</h2>
        <p className="muted small">مساحة عرض توضيحية — المنشآت خيالية والنتائج للتعلّم والمقارنة، لا للاعتماد التشغيلي.</p>
      </div>
      {empty ? (
        <Card>
          <EmptyState icon="✈" title="لا توجد مشاريع بعد"
            text="ابدأ بالمخطط النموذجي لمطار سَبّاق الافتراضي، أو أنشئ مشروعًا وارفع مخططك في استوديو المخطط."
            action={<div className="row" style={{ justifyContent: "center" }}><Button variant="go" loading={busy} onClick={createSample}>ابدأ بالمشروع النموذجي</Button><Button onClick={() => go("project-new")}>مشروع جديد</Button></div>} />
        </Card>
      ) : (
        <>
          <div className="grid g4">
            <Stat k="المشاريع" v={projects.length} />
            <Stat k="المحاكاة المحفوظة" v={sims} />
            <Stat k="تحسينات مختبرة" v={improvements} />
            <Stat k="التقارير" v={reports} />
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="h2">مشاريعك</h2>
            <Button size="sm" onClick={() => go("projects")}>عرض الكل</Button>
          </div>
          <div className="grid g3">
            {projects.slice(0, 3).map((p) => (
              <button key={p.id} className="card clickable tight col" style={{ gap: 10 }} onClick={() => { setActiveId(p.id); go("project", p.id); }}>
                <ProjectThumb p={p} />
                <strong className="h3">{p.name}</strong>
                <span className="small muted">{p.status === "ready" ? "مخطط جاهز" : "مسودة"} · {FACILITY[p.facility]}</span>
              </button>
            ))}
          </div>
          <Card>
            <div className="card-head"><h2 className="h2">آخر المحاكاة والتحسينات</h2><Button size="sm" onClick={() => go("analytics")}>عرض التحليل</Button></div>
            {runs.length === 0 ? <EmptyState title="لم تُحفظ أي نتائج بعد" text="شغّل محاكاة في المختبر ثم اضغط «حفظ النتائج»." action={<Button size="sm" variant="go" onClick={() => go("lab")}>فتح المختبر</Button>} /> : <RunsTable runs={runs.slice(0, 5)} />}
          </Card>
        </>
      )}
    </div>
  );
}

export const KIND: Record<string, string> = { simulation: "محاكاة", improvement: "تحسين", stress: "اختبار ضغط", challenge: "تحدٍّ", duel: "مواجهة", robustness: "اختبار تحمّل" };
export function RunsTable({ runs, projects }: { runs: Run[]; projects?: Project[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>السيناريو</th><th>النوع</th>{projects && <th>المشروع</th>}<th>زمن الإخلاء</th><th>الإكمال</th><th>مؤشر السلامة</th><th>التاريخ</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>{r.title}</td>
              <td><Chip>{KIND[r.kind]}</Chip></td>
              {projects && <td>{projects.find((p) => p.id === r.projectId)?.name ?? "—"}</td>}
              <td className="num">{fmtTime(r.summary.evacTime)}</td>
              <td className="num">{Math.round(r.summary.completion * 100)}%</td>
              <td><Chip tone={r.score >= 70 ? "green" : r.score >= 50 ? "yellow" : "red"}>{r.score}</Chip></td>
              <td className="small muted">{fmtDate(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectsList() {
  const { projects, setActiveId, activeId } = useApp();
  const [q, setQ] = useState("");
  const list = projects.filter((p) => p.name.includes(q.trim()));
  return (
    <div className="page">
      <PageHead crumbs={[["مساحة العمل", "dashboard"], ["مشاريعي"]]} title="مشاريعي" actions={<Button variant="primary" onClick={() => go("project-new")}>+ مشروع جديد</Button>} />
      <div className="row"><input className="input" style={{ maxWidth: 360 }} placeholder="ابحث باسم المشروع" aria-label="بحث في المشاريع" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {projects.length === 0 ? (
        <Card><EmptyState icon="▤" title="لا توجد مشاريع" text="أنشئ مشروعك الأول للبدء." action={<Button variant="go" onClick={() => go("project-new")}>إنشاء مشروع</Button>} /></Card>
      ) : list.length === 0 ? <Card><EmptyState title="لا نتائج مطابقة" text={`لا يوجد مشروع يحتوي «${q}».`} /></Card> : (
        <div className="grid g3">
          {list.map((p) => (
            <button key={p.id} className="card clickable tight col" style={{ gap: 10 }} onClick={() => { setActiveId(p.id); go("project", p.id); }}>
              <ProjectThumb p={p} />
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong className="h3">{p.name}</strong>
                {p.id === activeId && <Chip tone="green">النشط</Chip>}
              </div>
              <span className="small muted">{FACILITY[p.facility]} · {p.source === "traced" ? "مخطط مرفوع" : "مخطط نموذجي"} · آخر تعديل {fmtDate(p.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const STEPS = ["المعلومات", "المنشأة", "مصدر المخطط", "المراجعة"];
export function NewProject() {
  const { refreshProjects, setActiveId, toast } = useApp();
  const [step, setStep] = useState(0);
  const [v, setV] = useState({ name: "", description: "", facility: "terminal" as FacilityType, source: "builtin" as "builtin" | "traced" });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameErr = v.name.trim().length < 3 ? "اسم المشروع 3 أحرف على الأقل" : undefined;
  const next = () => { setTouched(true); if (step === 0 && nameErr) return; setStep(step + 1); };
  const create = async () => {
    setBusy(true);
    try {
      const base = sampleProject(v.name.trim());
      const p = await api.createProject({ ...base, description: v.description, facility: v.facility, source: v.source, status: "ready" });
      await refreshProjects(); setActiveId(p.id);
      toast("تم إنشاء المشروع", "ok");
      v.source === "traced" ? go("studio") : go("project", p.id);
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const opt = (sel: boolean) => ({ className: `card clickable tight ${sel ? "" : ""}`, style: { borderColor: sel ? "var(--green)" : undefined, background: sel ? "var(--green-soft)" : undefined } });
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <PageHead crumbs={[["مشاريعي", "projects"], ["مشروع جديد"]]} title={`مشروع جديد — ${STEPS[step]}`} />
      <div className="stepper" aria-label="خطوات إنشاء المشروع">
        {STEPS.map((s, i) => <div key={s} className={`st ${i < step ? "done" : i === step ? "cur" : ""}`} aria-current={i === step ? "step" : undefined}>{i < step ? "✓ " : `${i + 1}. `}{s}</div>)}
      </div>
      <Card className="col">
        {step === 0 && (
          <>
            <Field label="اسم المشروع" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={touched ? nameErr : undefined} placeholder="مثال: صالة المغادرة الشمالية" autoFocus />
            <div className="field"><label htmlFor="desc">وصف مختصر (اختياري)</label><textarea id="desc" className="input" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
          </>
        )}
        {step === 1 && (
          <div className="grid g3" role="radiogroup" aria-label="نوع المنشأة">
            {(Object.keys(FACILITY) as FacilityType[]).map((k) => (
              <button key={k} role="radio" aria-checked={v.facility === k} {...opt(v.facility === k)} onClick={() => setV({ ...v, facility: k })}>
                <strong>{FACILITY[k]}</strong>
                <div className="small muted">{k === "terminal" ? "بوابات وبهو ومناطق خدمة" : k === "training" ? "بيئة تدريب وتمارين إخلاء" : "تدفّق ركاب كثيف عبر صالة واحدة"}</div>
              </button>
            ))}
          </div>
        )}
        {step === 2 && (
          <div className="grid g2" role="radiogroup" aria-label="مصدر المخطط">
            <button role="radio" aria-checked={v.source === "builtin"} {...opt(v.source === "builtin")} onClick={() => setV({ ...v, source: "builtin" })}>
              <strong>المخطط النموذجي</strong>
              <div className="small muted">مبنى ركاب خيالي جاهز للمحاكاة فورًا.</div>
            </button>
            <button role="radio" aria-checked={v.source === "traced"} {...opt(v.source === "traced")} onClick={() => setV({ ...v, source: "traced" })}>
              <strong>رفع مخطط وتتبّعه</strong>
              <div className="small muted">ارفع صورة مخططك وعايره في الاستوديو (يبدأ المشروع بالمخطط النموذجي للمحاكاة).</div>
            </button>
          </div>
        )}
        {step === 3 && (
          <div className="col">
            <div className="grid g2">
              <div><div className="small muted">الاسم</div><strong>{v.name}</strong></div>
              <div><div className="small muted">المنشأة</div><strong>{FACILITY[v.facility]}</strong></div>
              <div><div className="small muted">مصدر المخطط</div><strong>{v.source === "builtin" ? "المخطط النموذجي" : "رفع مخطط وتتبّعه"}</strong></div>
              <div><div className="small muted">الحالة بعد الإنشاء</div><strong>جاهز للمحاكاة</strong></div>
            </div>
            {v.description && <p className="secondary small">{v.description}</p>}
          </div>
        )}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <Button variant="ghost" onClick={() => (step === 0 ? go("projects") : setStep(step - 1))}>{step === 0 ? "إلغاء" : "السابق"}</Button>
          {step < 3 ? <Button variant="blue" onClick={next}>التالي</Button> : <Button variant="primary" loading={busy} onClick={create}>إنشاء المشروع</Button>}
        </div>
      </Card>
    </div>
  );
}

export function ProjectDetail({ id }: { id: string }) {
  const { refreshProjects, setActiveId, toast } = useApp();
  const [p, setP] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const load = () => { setErr(null); Promise.all([api.getProject(id), api.listRuns(id)]).then(([pp, rr]) => { setP(pp); setRuns(rr); setActiveId(pp.id); }).catch((e) => setErr(e.message)); };
  useEffect(load, [id]);
  if (err) return <ErrorState text={err} retry={load} />;
  if (!p) return <Loading />;
  const hz = p.config.hazard;
  return (
    <div className="page">
      <PageHead crumbs={[["مشاريعي", "projects"], [p.name]]} title={p.name} status={<Chip tone={p.status === "ready" ? "green" : "yellow"}>{p.status === "ready" ? "جاهز" : "مسودة"}</Chip>}
        actions={<>
          <Button onClick={() => setRename(p.name)}>إعادة التسمية</Button>
          <Button onClick={() => go("studio")}>استوديو المخطط</Button>
          <Button variant="go" disabled={p.status !== "ready"} onClick={() => go("lab")}>▶ فتح المختبر</Button>
        </>} />
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)" }}>
        <Card><AirportMap layout={p.layout} cfg={p.config} t={(hz?.at ?? 0) + 20} /></Card>
        <Card className="col">
          <h2 className="h2">ملف المشروع</h2>
          <div className="small muted">{p.description || "لا يوجد وصف."}</div>
          <div className="metric"><span className="k">المنشأة</span><strong>{FACILITY[p.facility]} · {p.layout.zones.length} مساحة · {p.layout.exits.length} مخارج</strong></div>
          <div className="metric"><span className="k">السيناريو المحفوظ</span><strong>{p.config.passengers} مسافر · {p.config.staff} موظف · {hz ? `${HAZARD_LABELS[hz.type]} في ${p.layout.zones.find((z) => z.id === hz.zoneId)?.name}` : "بدون خطر"}</strong></div>
          <div className="metric"><span className="k">أُنشئ</span><strong>{fmtDate(p.createdAt)}</strong></div>
          <div className="spacer" />
          <Button variant="danger" onClick={() => setDel(true)}>حذف المشروع</Button>
        </Card>
      </div>
      <Card>
        <div className="card-head"><h2 className="h2">سجل نتائج المشروع</h2><span className="small muted">{runs.length} نتيجة</span></div>
        {runs.length ? <RunsTable runs={runs} /> : <EmptyState title="لا توجد نتائج محفوظة" text="شغّل محاكاة واحفظ نتائجها لتظهر هنا." />}
      </Card>
      {rename !== null && (
        <Modal title="إعادة تسمية المشروع" onClose={() => setRename(null)} actions={<>
          <Button variant="ghost" onClick={() => setRename(null)}>إلغاء</Button>
          <Button variant="go" disabled={rename.trim().length < 3} onClick={async () => { const np = await api.updateProject(p.id, { name: rename.trim() }); setP(np); await refreshProjects(); setRename(null); toast("تم الحفظ", "ok"); }}>حفظ</Button>
        </>}>
          <Field label="اسم المشروع" value={rename} onChange={(e) => setRename(e.target.value)} />
        </Modal>
      )}
      {del && (
        <Modal title="حذف المشروع" onClose={() => setDel(false)} actions={<>
          <Button variant="ghost" onClick={() => setDel(false)}>إلغاء</Button>
          <Button variant="primary" disabled={confirmText.trim() !== p.name} onClick={async () => {
            await api.deleteProject(p.id); setActiveId(null); await refreshProjects(); toast("تم حذف المشروع", "ok"); go("projects");
          }}>حذف نهائي</Button>
        </>}>
          <p className="secondary">سيُحذف المشروع و{runs.length} نتيجة محفوظة والتقارير المرتبطة به. لا يمكن التراجع عن هذا الإجراء.</p>
          <Field label={`اكتب «${p.name}» للتأكيد`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
