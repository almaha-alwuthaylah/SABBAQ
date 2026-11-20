import React, { useMemo, useRef, useState } from "react";
import { go, useApp } from "../app/store";
import { Button, Card, Chip, EmptyState, Field, PageHead, Tabs } from "../ui/kit";
import { AirportMap } from "../map/AirportMap";
import { DEFAULT_CONFIG, Simulation } from "../sim/engine";
import { inRect } from "../sim/layout";

type Step = "upload" | "calibrate" | "geometry" | "exits" | "connectivity";
const SPECIFIC_FLOW = 1.33;

export function Studio(_: { id?: string }) {
  const { active, layout } = useApp();
  const [step, setStep] = useState<Step>("upload");
  const [img, setImg] = useState<{ url: string; name: string; w: number; h: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pts, setPts] = useState<{ x: number; y: number }[]>([]);
  const [metres, setMetres] = useState("20");
  const imgRef = useRef<HTMLImageElement>(null);

  const conn = useMemo(() => {
    const s = new Simulation({ ...DEFAULT_CONFIG, passengers: 1, staff: 0 }, layout);
    return layout.zones.map((z) => {
      let walk = 0, bad = 0;
      for (let i = 0; i < s.walk.length; i++) {
        if (!s.walk[i]) continue;
        const x = (i % s.cols) * 10 + 5, y = Math.floor(i / s.cols) * 10 + 5;
        if (!inRect(z.rect, x, y)) continue;
        walk++;
        if (s.field[i] >= 1e9) bad++;
      }
      return { z, walk, bad };
    });
  }, [layout]);

  if (!active) return <div className="page"><PageHead title="استوديو المخطط" /><Card><EmptyState title="اختر مشروعًا أولًا" action={<Button variant="go" onClick={() => go("projects")}>المشاريع</Button>} /></Card></div>;

  const onFile = (f?: File) => {
    setErr(null);
    if (!f) return;
    if (!/^image\/(png|jpe?g|svg\+xml|webp)$/.test(f.type)) return setErr("الصيغ المدعومة: PNG أو JPG أو SVG أو WebP");
    if (f.size > 8 * 1024 * 1024) return setErr("الحد الأقصى لحجم الملف 8 ميغابايت");
    const r = new FileReader();
    r.onload = () => { const url = String(r.result); const im = new Image(); im.onload = () => { setImg({ url, name: f.name, w: im.naturalWidth, h: im.naturalHeight }); setPts([]); }; im.src = url; };
    r.onerror = () => setErr("تعذّرت قراءة الملف");
    r.readAsDataURL(f);
  };
  const pxDist = pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  const m = parseFloat(metres);
  const mPerPx = pxDist && m > 0 ? m / pxDist : 0;
  const area = (w: number, h: number) => Math.round(w * h * layout.unitM * layout.unitM);
  const totalBad = conn.reduce((a, c) => a + c.bad, 0);

  return (
    <div className="page">
      <PageHead crumbs={[["مشاريعي", "projects"], [active.name, "project-" + active.id], ["استوديو المخطط"]]} title="استوديو المخطط"
        subtitle="ارفع مخططك وعايره بصريًا. التحويل الآلي للمخطط المرفوع إلى نموذج محاكاة غير مضمّن في هذا العرض — فحوصات الهندسة والاتصال تعمل على مخطط المشروع الحالي." />
      <Tabs value={step} onChange={setStep} items={[["upload", "1. رفع المخطط"], ["calibrate", "2. معايرة المقياس"], ["geometry", "3. مراجعة الهندسة"], ["exits", "4. المداخل والمخارج"], ["connectivity", "5. فحص الاتصال"]]} />
      {step === "upload" && (
        <Card className="col">
          <label className="card flat col" style={{ alignItems: "center", borderStyle: "dashed", cursor: "pointer", padding: 32 }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            <span style={{ fontSize: 28 }}>⇪</span><strong>اسحب صورة المخطط هنا أو انقر للاختيار</strong><span className="small muted">PNG · JPG · SVG · WebP — حتى 8 ميغابايت</span>
          </label>
          {err && <div className="verdict worse small" role="alert">{err}</div>}
          {img ? (
            <div className="col"><div className="row" style={{ justifyContent: "space-between" }}><span className="small">{img.name} · <span className="num">{img.w}×{img.h}</span> بكسل</span><Button variant="go" onClick={() => setStep("calibrate")}>متابعة إلى المعايرة</Button></div>
              <img src={img.url} alt="معاينة المخطط المرفوع" style={{ maxWidth: "100%", borderRadius: 12, border: "1px solid var(--border)" }} /></div>
          ) : <AirportMap layout={layout} cfg={{ ...DEFAULT_CONFIG, hazard: null }} t={0} caption="المخطط الحالي للمشروع" />}
        </Card>
      )}
      {step === "calibrate" && (
        <Card className="col">
          {!img ? <EmptyState title="ارفع مخططًا أولًا" action={<Button onClick={() => setStep("upload")}>رفع المخطط</Button>} /> : (
            <>
              <p className="small secondary">انقر نقطتين على المخطط تفصلهما مسافة معروفة (مثل عرض ممر)، ثم أدخل المسافة الحقيقية.</p>
              <div style={{ position: "relative", cursor: "crosshair" }} onClick={(e) => {
                const r = imgRef.current!.getBoundingClientRect(); const sc = img.w / r.width;
                const p = { x: (e.clientX - r.left) * sc, y: (e.clientY - r.top) * sc };
                setPts((q) => (q.length >= 2 ? [p] : [...q, p]));
              }}>
                <img ref={imgRef} src={img.url} alt="المخطط للمعايرة" style={{ width: "100%", display: "block", borderRadius: 12 }} />
                <svg viewBox={`0 0 ${img.w} ${img.h}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                  {pts.length === 2 && <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke="#ed2346" strokeWidth={img.w / 300} strokeDasharray={`${img.w / 100} ${img.w / 150}`} />}
                  {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={img.w / 120} fill="#ed2346" stroke="#fff" strokeWidth={img.w / 600} />)}
                </svg>
              </div>
              <div className="row">
                <div style={{ width: 200 }}><Field label="المسافة الحقيقية (م)" inputMode="decimal" value={metres} onChange={(e) => setMetres(e.target.value)} error={!(m > 0) ? "أدخل رقمًا موجبًا" : undefined} /></div>
                {mPerPx > 0 ? <Chip tone="green">المقياس: 1 بكسل = {mPerPx.toFixed(3)} م · المخطط ≈ {Math.round(img.w * mPerPx)} × {Math.round(img.h * mPerPx)} م</Chip> : <Chip>حدّد نقطتين ({pts.length}/2)</Chip>}
              </div>
            </>
          )}
        </Card>
      )}
      {step === "geometry" && (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
          <Card><AirportMap layout={layout} cfg={{ ...DEFAULT_CONFIG, hazard: null }} t={0} /></Card>
          <Card><h2 className="h2" style={{ marginBottom: 8 }}>المساحات ({layout.zones.length})</h2>
            <table className="table"><thead><tr><th>المساحة</th><th>النوع</th><th>المساحة م²</th></tr></thead>
              <tbody>{layout.zones.map((z) => <tr key={z.id}><td>{z.name}</td><td className="small muted">{z.kind === "gate" ? "صالة انتظار" : z.kind === "concourse" ? "بهو" : "خدمات"}</td><td className="num">{area(z.rect.w, z.rect.h)}</td></tr>)}</tbody>
            </table>
            <p className="small muted">المساحة الإجمالية القابلة للمشي ≈ <span className="num">{layout.zones.reduce((a, z) => a + area(z.rect.w, z.rect.h), 0)}</span> م².</p>
          </Card>
        </div>
      )}
      {step === "exits" && (
        <Card><h2 className="h2" style={{ marginBottom: 8 }}>المخارج وسعتها التقديرية</h2>
          <table className="table"><thead><tr><th>المخرج</th><th>النوع</th><th>العرض</th><th>السعة (شخص/دقيقة)</th></tr></thead>
            <tbody>{layout.exits.map((e) => <tr key={e.id}><td>{e.name}</td><td><Chip tone={e.emergency ? "orange" : "green"}>{e.emergency ? "طوارئ" : "رئيسي"}</Chip></td><td className="num">{e.widthM} م</td><td className="num">{Math.round(e.widthM * SPECIFIC_FLOW * 60)}</td></tr>)}</tbody>
          </table>
          <p className="small muted">السعة = العرض × 1.33 شخص/م/ث (قيمة تدفق نوعي شائعة في أدبيات الإخلاء؛ تقديرية).</p>
        </Card>
      )}
      {step === "connectivity" && (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
          <Card><AirportMap layout={layout} cfg={{ ...DEFAULT_CONFIG, hazard: null }} t={0} /></Card>
          <Card className="col">
            <div className={`verdict ${totalBad ? "worse" : "better"}`}><strong>{totalBad ? "✕" : "✓"}</strong><span>{totalBad ? `${totalBad} م² بلا مسار إلى أي مخرج` : "كل المساحات متصلة بمخرج واحد على الأقل"}</span></div>
            {conn.map(({ z, walk, bad }) => <div key={z.id} className="row" style={{ justifyContent: "space-between" }}><span className="small">{z.name}</span><Chip tone={bad ? "red" : "green"}>{bad ? `${bad}/${walk} م² معزولة` : "متصلة"}</Chip></div>)}
            <Button variant="go" onClick={() => go("lab")}>▶ إلى مختبر المحاكاة</Button>
          </Card>
        </div>
      )}
    </div>
  );
}
