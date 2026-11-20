import React, { useEffect, useState } from "react";
import { api } from "../data/api";
import { go, useApp } from "../app/store";
import { Button, Card, Chip, Metric, Modal, NumberField, PageHead, SelectField, Spark, fmtTime, pct } from "../ui/kit";
import { AirportMap, MapLegend } from "../map/AirportMap";
import { useSimulation } from "../map/useSimulation";
import { Distribution, HAZARD_LABELS, HazardType, SimConfig, DEFAULT_CONFIG } from "../sim/engine";
import { Layout, DEFAULT_LAYOUT } from "../sim/layout";
import { IMPROVEMENTS, safetyScore } from "../sim/analysis";

const HZ: [HazardType, string][] = [["fire", "🔥"], ["electrical", "⚡"], ["gas", "☁"], ["crowd", "👥"], ["closure", "⛔"], ["operational", "⚠"]];

export function SessionSettings({ cfg, set, disabled, layout }: { cfg: SimConfig; set(c: SimConfig): void; disabled?: boolean; layout: Layout }) {
  const [picking, setPicking] = useState(false);
  void picking;
  return (
    <div className="col" style={{ gap: 12 }}>
      <h2 className="h2">إعدادات الجلسة</h2>
      <NumberField label="عدد المسافرين" value={cfg.passengers} min={10} max={2000} step={10} onChange={(v) => set({ ...cfg, passengers: v })} disabled={disabled} />
      <NumberField label="عدد الموظفين" value={cfg.staff} min={0} max={200} onChange={(v) => set({ ...cfg, staff: v })} disabled={disabled} />
      <NumberField label="أبواب المدخل المتاحة" value={cfg.entrances} min={0} max={2} onChange={(v) => set({ ...cfg, entrances: v })} disabled={disabled} />
      <NumberField label="عدد المخارج" value={cfg.exits} min={1} max={layout.exits.length} onChange={(v) => set({ ...cfg, exits: v, emergencyExits: Math.min(cfg.emergencyExits, v) })} disabled={disabled} />
      <NumberField label="منها مخارج طوارئ" value={cfg.emergencyExits} min={0} max={Math.min(2, cfg.exits)} onChange={(v) => set({ ...cfg, emergencyExits: v })} disabled={disabled} />
      <div className="numfield"><span className="lbl">توزيع الأشخاص</span>
        <div style={{ width: 130 }}><SelectField small value={cfg.distribution} onChange={(v) => set({ ...cfg, distribution: v as Distribution })} options={[["balanced", "متوازن"], ["gates", "تركّز في البوابات"], ["concourse", "تركّز في البهو"]]} /></div>
      </div>
      <NumberField label="سرعة الحركة" value={cfg.speed} min={0.5} max={2} step={0.1} unit="م/ث" onChange={(v) => set({ ...cfg, speed: v })} disabled={disabled} />
    </div>
  );
}

export function HazardPanel({ cfg, set, disabled, picking, setPicking, layout }: { cfg: SimConfig; set(c: SimConfig): void; disabled?: boolean; picking: boolean; setPicking(v: boolean): void; layout: Layout }) {
  const h = cfg.hazard;
  const zone = h ? layout.zones.find((z) => z.id === h.zoneId) : null;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="h2">سيناريو الخطر</h2>
        {h && !disabled && <Button size="sm" variant="ghost" onClick={() => set({ ...cfg, hazard: null })}>إزالة</Button>}
      </div>
      <div className="hazards" role="radiogroup" aria-label="نوع الخطر">
        {HZ.map(([t, ic]) => (
          <button key={t} role="radio" aria-checked={h?.type === t} disabled={disabled} className={`hz ${t} ${h?.type === t ? "active" : ""}`}
            onClick={() => set({ ...cfg, hazard: { zoneId: h?.zoneId ?? "G03", at: h?.at ?? 30, point: h?.point, type: t } })}>
            <span>{HAZARD_LABELS[t]}</span><span aria-hidden>{ic}</span>
          </button>
        ))}
      </div>
      {h ? (
        <>
          <NumberField label={`التفعيل (${fmtTime(h.at)})`} value={h.at} min={0} max={300} step={5} unit="ث" disabled={disabled} onChange={(v) => set({ ...cfg, hazard: { ...h, at: v } })} />
          <div className="numfield"><span className="lbl">الموقع</span>
            <div style={{ width: 150 }}><SelectField small value={h.zoneId} onChange={(v) => set({ ...cfg, hazard: { ...h, zoneId: v, point: undefined } })} options={layout.zones.map((z) => [z.id, z.name])} /></div>
          </div>
          <Button variant="danger" disabled={disabled} onClick={() => setPicking(!picking)} aria-pressed={picking}>{picking ? "انقر على الخريطة… (إلغاء)" : "تحديد الخطر على الخريطة"}</Button>
          <span className="tiny muted">{zone?.name}{h.point ? ` · نقطة (${h.point.x}, ${h.point.y})` : " · مركز المساحة"}</span>
        </>
      ) : <span className="small muted">اختر نوع الخطر لإضافته إلى السيناريو، أو شغّل تمرين إخلاء بدون خطر.</span>}
    </div>
  );
}

export function statusOf(s: ReturnType<typeof useSimulation>) {
  const m = s.metrics;
  if (s.phase === "idle") return { text: "جاهز للبدء", tone: "gray" as const, title: "مختبر المحاكاة" };
  if (s.phase === "done") return { text: "✓ اكتملت المحاكاة", tone: "green" as const, title: "اكتملت المحاكاة" };
  if (s.phase === "paused") return { text: "‖ متوقفة مؤقتًا", tone: "yellow" as const, title: "المحاكاة متوقفة مؤقتًا" };
  if (m?.hazardActive && m.congestion > 0) return { text: "↻ جارٍ إعادة التوجيه", tone: "orange" as const, title: "إعادة التوجيه" };
  if (m?.congestion) return { text: "◉ ارتفاع الازدحام", tone: "yellow" as const, title: "ارتفاع الازدحام" };
  if (m?.hazardActive) return { text: "! تم تفعيل الخطر", tone: "red" as const, title: "تفعيل الخطر" };
  return { text: "● جارٍ المحاكاة", tone: "green" as const, title: "مختبر المحاكاة" };
}

export function PlaybackControls({ s }: { s: ReturnType<typeof useSimulation> }) {
  const running = s.phase === "running";
  return (
    <div className="controls">
      <Button variant={running ? "blue" : "go"} onClick={() => (running ? s.pause() : s.phase === "paused" ? s.resume() : s.start())} style={{ minWidth: 140 }}>
        {running ? "‖ إيقاف مؤقت" : s.phase === "paused" ? "▶ استئناف" : s.phase === "done" ? "↻ إعادة التشغيل" : "▶ بدء المحاكاة"}
      </Button>
      <span className="num small" style={{ minWidth: 44 }}>{fmtTime(s.viewT)}</span>
      <input className="timeline" type="range" min={0} max={Math.round(s.duration)} step={0.5} value={s.viewT} aria-label="الخط الزمني للمحاكاة"
        onChange={(e) => s.seek(parseFloat(e.target.value))}
        style={{ background: `linear-gradient(to left, var(--red) ${(s.viewT / s.duration) * 100}%, #0a1730 0)` }} />
      <div className="row" style={{ gap: 2 }} role="group" aria-label="سرعة التشغيل">
        {[1, 2, 4].map((x) => <button key={x} className={`speedbtn ${s.speed === x ? "active" : ""}`} aria-pressed={s.speed === x} onClick={() => s.setSpeed(x)}>{x}×</button>)}
      </div>
      <button className="speedbtn" title="تخطَّ إلى النتيجة" aria-label="تخطَّ إلى النتيجة" onClick={() => s.finish()} disabled={s.phase === "done"}>⏭</button>
      <button className="speedbtn" title="إعادة الضبط" aria-label="إعادة الضبط" onClick={() => s.reset()}>■</button>
    </div>
  );
}

export function LiveMetricsCard({ s }: { s: ReturnType<typeof useSimulation> }) {
  const m = s.metrics;
  const elapsed = m ? (m.evacTime ?? (s.phase === "idle" ? null : Math.max(0, m.t - (s.sim?.alarmAt ?? 0)))) : null;
  return (
    <Card className="tight" aria-live="polite">
      <h2 className="h3" style={{ gridColumn: "1 / -1" }}>مؤشرات المحاكاة الحالية</h2>
      <Metric k={m?.evacTime != null ? "زمن الإخلاء" : "الزمن منذ الإنذار"} v={fmtTime(elapsed)} />
      <Metric k="اكتمال الإخلاء" v={m ? pct(m.completion) : "0%"} tone={m && m.completion === 1 ? "green" : undefined} />
      <Metric k="أشخاص يتعذّر وصولهم" v={m && s.phase !== "idle" ? m.trapped : "—"} tone={m?.trapped ? "red" : undefined} />
      <Metric k="نقاط الازدحام النشطة" v={m?.congestion ?? 0} tone={m?.congestion ? "yellow" : undefined} />
      <Metric k="المخارج المتاحة" v={m ? `${m.exitsOpen} / ${m.exitsTotal}` : "—"} tone="green" />
      <Metric k="المخارج المغلقة" v={m ? m.exitsTotal - m.exitsOpen : 0} tone={m && m.exitsTotal - m.exitsOpen ? "red" : undefined} />
      <div style={{ gridColumn: "1 / -1" }}>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}><strong className="small">ساعة المحاكاة</strong><span className="num">{fmtTime(s.viewT)}</span></div>
        <div className="small muted" style={{ marginTop: 6 }}>تاريخ الازدحام (أعلى كثافة شخص/م²)</div>
        <Spark data={m?.history ?? []} max={5} labels={["00:00", fmtTime(s.viewT)]} />
      </div>
    </Card>
  );
}

export function Lab({ guest = false }: { guest?: boolean }) {
  const app = useApp();
  const { scenario, setScenario, active, toast, user } = app;
  const layout = guest ? DEFAULT_LAYOUT : active?.layout ?? DEFAULT_LAYOUT;
  const [guestCfg, setGuestCfg] = useState<SimConfig>({ ...DEFAULT_CONFIG, hazard: { type: "fire", zoneId: "G03", at: 30 } });
  const cfg = guest ? guestCfg : scenario;
  const setCfg = guest ? setGuestCfg : setScenario;
  const s = useSimulation(cfg, layout);
  const [picking, setPicking] = useState(false);
  const [layer] = useState<"all">("all");
  const [savePrompt, setSavePrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const locked = s.phase !== "idle";
  const st = statusOf(s);
  useEffect(() => setSaved(false), [s.version]);
  useEffect(() => { if (guest && s.phase === "done") setSavePrompt(true); }, [s.phase]);

  if (!guest && !active) return (
    <div className="page"><PageHead title="مختبر المحاكاة" /><Card><div className="state"><strong>اختر مشروعًا أولًا</strong><span className="small">المختبر يعمل على مخطط مشروع نشط.</span><Button variant="go" onClick={() => go("projects")}>المشاريع</Button></div></Card></div>
  );

  const save = async () => {
    if (guest || !user) return setSavePrompt(true);
    if (!active || !s.sim) return;
    setSaving(true);
    try {
      if (!s.sim.done) s.finish();
      const summary = s.sim.summary();
      const h = cfg.hazard;
      await api.createRun({ projectId: active.id, kind: "simulation", title: h ? `${HAZARD_LABELS[h.type]} – ${layout.zones.find((z) => z.id === h.zoneId)?.name}` : "تمرين إخلاء بدون خطر", config: cfg, summary, score: safetyScore(summary) });
      await api.updateProject(active.id, { config: cfg });
      setSaved(true);
      toast("تم حفظ النتائج في سجل المشروع", "ok");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setSaving(false); }
  };

  return (
    <div className="page">
      <PageHead crumbs={guest ? [["جرّب سَبّاق"], ["مختبر المحاكاة"]] : [["مساحة العمل", "dashboard"], [active!.name, "project-" + active!.id], ["مختبر المحاكاة"]]}
        title={guest ? "جرّب سَبّاق" : st.title}
        status={<Chip tone={st.tone}>{st.text}</Chip>}
        actions={<>
          {!guest && <Button variant="danger" onClick={() => go("stress")}>اكسر خطتي</Button>}
          <Button variant="go" loading={saving} disabled={s.phase === "idle" || saved} onClick={save}>{saved ? "✓ تم الحفظ" : "حفظ النتائج"}</Button>
          {guest && <Button onClick={() => go("welcome")}>الخروج</Button>}
        </>} />
      <div className="lab">
        <Card className="settings col tight" style={{ gap: 20 }}>
          <SessionSettings cfg={cfg} set={setCfg} disabled={locked} layout={layout} />
          <HazardPanel cfg={cfg} set={(c) => { setCfg(c); }} disabled={locked} picking={picking} setPicking={setPicking} layout={layout} />
          {locked && <span className="tiny muted">أوقف المحاكاة وأعد الضبط (■) لتعديل الإعدادات.</span>}
        </Card>
        <div className="col mapcol" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="small secondary">{layout.building} / طبقة المحاكاة الحية</span>
            {!guest && <Button size="sm" variant="blue" onClick={() => go("risk")}>عدسة الخطر</Button>}
          </div>
          <AirportMap layout={layout} cfg={cfg} t={s.viewT} getAgents={s.getAgents} sim={s.sim} routes={s.routes} layer={layer}
            picking={picking} onPick={(zoneId, point) => { setCfg({ ...cfg, hazard: { type: cfg.hazard?.type ?? "fire", at: cfg.hazard?.at ?? 30, zoneId, point } }); setPicking(false); }} />
          <MapLegend />
          <PlaybackControls s={s} />
          {s.replay && <span className="tiny" style={{ color: "var(--yellow)" }}>وضع الإعادة: تعرض لقطات مسجّلة. اسحب المؤشر إلى النهاية للعودة للبث الحي.</span>}
        </div>
        <div className="metrics"><LiveMetricsCard s={s} /></div>
      </div>
      {!guest && (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="h2">التحسينات المقترحة</h2>
            <span className="small muted">خيارات تقديرية حتى إعادة الاختبار</span>
            <div className="row">
              <Button variant="go" disabled={s.phase !== "done"} onClick={() => go("compare")}>{s.phase === "done" ? "عرض المقارنة" : "إعادة المحاكاة بعد التحسين"}</Button>
              <Button variant="danger" onClick={() => go("improve")}>أنقذ الخطة</Button>
            </div>
          </div>
          <div className="grid g3">
            {IMPROVEMENTS.slice(0, 3).map((c) => (
              <button key={c.id} className="card clickable tight col" style={{ gap: 4 }} onClick={() => go("improve")}>
                <strong className="h3">{c.title}</strong>
                <span className="small secondary">{c.detail}</span>
                <span className="tiny muted">{c.requirement}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {savePrompt && (
        <Modal title="احفظ مشاريعك مع سَبّاق" onClose={() => setSavePrompt(false)} actions={<>
          <Button variant="ghost" onClick={() => setSavePrompt(false)}>متابعة التجربة</Button>
          <Button onClick={() => go("login")}>تسجيل الدخول</Button>
          <Button variant="primary" onClick={() => go("register")}>إنشاء حساب مجاني</Button>
        </>}>
          {s.phase === "done" && s.metrics && (
            <div className="grid g3">
              <div><div className="small muted">زمن الإخلاء</div><strong className="h2 num">{fmtTime(s.metrics.evacTime)}</strong></div>
              <div><div className="small muted">الإكمال</div><strong className="h2 num">{pct(s.metrics.completion)}</strong></div>
              <div><div className="small muted">يتعذّر وصولهم</div><strong className="h2 num">{s.metrics.trapped}</strong></div>
            </div>
          )}
          <p className="secondary">وضع الزائر لا يحفظ النتائج. أنشئ حسابًا لحفظ المحاكاة، واختبار التحسينات، ومقارنة الحلول، وإصدار ملفات قرار السلامة.</p>
        </Modal>
      )}
    </div>
  );
}
