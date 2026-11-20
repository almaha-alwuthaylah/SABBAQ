import React, { useEffect, useState } from "react";
import { api, EMAIL_RE } from "../data/api";
import { ApiError } from "../data/types";
import { go, useApp } from "../app/store";
import { Toasts } from "../app/Shell";
import { Button, Card, Field, Logo } from "../ui/kit";
import { AirportMap } from "../map/AirportMap";
import { useSimulation } from "../map/useSimulation";
import { DEFAULT_CONFIG, SimConfig } from "../sim/engine";
import { DEFAULT_LAYOUT } from "../sim/layout";

const PREVIEW: SimConfig = { ...DEFAULT_CONFIG, passengers: 360, hazard: { type: "fire", zoneId: "G03", at: 8 } };

export function LivePreview({ compact = true }: { compact?: boolean }) {
  const s = useSimulation(PREVIEW, DEFAULT_LAYOUT);
  useEffect(() => { s.start(); }, []);
  useEffect(() => { if (s.phase === "done") { const t = setTimeout(() => s.start(), 1500); return () => clearTimeout(t); } }, [s.phase]);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row tiny muted" style={{ justifyContent: "space-between" }}>
        <span>مبنى الركاب · محاكاة الإخلاء</span>
        <span className="num">{s.metrics ? `${Math.round(s.metrics.completion * 100)}% · ${Math.round(s.viewT)} ث` : ""}</span>
      </div>
      <AirportMap layout={DEFAULT_LAYOUT} cfg={PREVIEW} t={s.viewT} getAgents={s.getAgents} sim={s.sim} routes={s.routes} compact={compact} ariaLabel="معاينة متحركة لإخلاء مبنى ركاب خيالي أثناء حريق" />
      <span className="tiny muted">منشأة خيالية • بيانات توضيحية</span>
    </div>
  );
}

function AuthFrame({ children, back }: { children: React.ReactNode; back?: string }) {
  const { toasts } = useApp();
  return (
    <div className="auth">
      <div className="auth-top">
        <Logo />
        {back && <Button size="sm" onClick={() => go(back)}>العودة</Button>}
      </div>
      <div className="auth-grid">
        <Card className="col" style={{ justifyContent: "center", alignItems: "stretch" }}>{children}</Card>
        <Card className="auth-visual col" style={{ gap: 20 }}>
          <div>
            <h2 className="hero-title">اختبر اليوم.<br />استعد للغد.</h2>
            <p className="secondary">قرارات السلامة تبدأ بفهم حركة الناس والمكان.</p>
          </div>
          <LivePreview />
        </Card>
      </div>
      <Toasts toasts={toasts} />
    </div>
  );
}

export function Welcome() {
  const { setGuest } = useApp();
  const { toasts } = useApp();
  return (
    <div className="auth">
      <div className="auth-top">
        <Logo />
        <div className="row">
          <Button size="sm" variant="ghost" onClick={() => go("login")}>تسجيل الدخول</Button>
          <Button size="sm" onClick={() => go("register")}>إنشاء حساب</Button>
        </div>
      </div>
      <div className="auth-grid" style={{ alignItems: "center" }}>
        <div className="col" style={{ gap: 24, padding: "24px 8px" }}>
          <span className="chip gray" style={{ alignSelf: "flex-start" }}>منصة توأم رقمي لمحاكاة طوارئ المطارات</span>
          <h1 className="h-display" style={{ fontSize: "clamp(32px, 4vw, 52px)" }}>نحاكي المخاطر<br />لنسبق وقوعها</h1>
          <p className="secondary" style={{ maxWidth: 520, fontSize: 18 }}>
            جرّب سيناريوهات الحريق والازدحام وإغلاق المخارج على مخطط تفاعلي، وقارن الحلول قبل أن تحتاجها.
          </p>
          <div className="row">
            <Button variant="primary" onClick={() => go("register")}>ابدأ الآن</Button>
            <Button variant="go" onClick={() => { setGuest(true); go("guest"); }}>▶ جرّب سَبّاق كزائر</Button>
          </div>
          <div className="grid g3" style={{ maxWidth: 560 }}>
            {[["محاكاة حيّة", "حركة الأشخاص لحظة بلحظة"], ["اكسر خطتك", "ابحث عن أسوأ سيناريو"], ["أنقذ الخطة", "قيّم التحسينات بالأرقام"]].map(([a, b]) => (
              <div key={a} className="card tight flat"><strong className="h3">{a}</strong><div className="small muted">{b}</div></div>
            ))}
          </div>
          <span className="tiny muted">جميع الخرائط والنتائج المعروضة توضيحية لمطار خيالي ولا تمثّل اعتمادًا هندسيًا.</span>
        </div>
        <Card><LivePreview /></Card>
      </div>
      <Toasts toasts={toasts} />
    </div>
  );
}

function useAuthForm() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return { busy, setBusy, err, setErr };
}

export function Login() {
  const { setUser, setGuest, toast } = useApp();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [touched, setTouched] = useState(false);
  const f = useAuthForm();
  const eErr = touched && !EMAIL_RE.test(email) ? "أدخل بريدًا إلكترونيًا صحيحًا" : undefined;
  const pErr = touched && pw.length < 8 ? "كلمة المرور 8 أحرف على الأقل" : undefined;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!EMAIL_RE.test(email) || pw.length < 8) return;
    f.setBusy(true); f.setErr(null);
    try {
      const u = await api.login(email, pw);
      setUser(u); toast(`مرحبًا بعودتك، ${u.name}`, "ok"); go("dashboard");
    } catch (x) { f.setErr(x instanceof ApiError ? x.message : "تعذّر الاتصال، حاول مجددًا"); }
    finally { f.setBusy(false); }
  };
  return (
    <AuthFrame back="welcome">
      <form className="col auth-form" onSubmit={submit} noValidate style={{ gap: 18, margin: "0 auto" }}>
        <div><h1 className="h1">تسجيل الدخول</h1><p className="muted">مرحبًا بعودتك. تابع من حيث توقفت.</p><p className="tiny muted">عرض توضيحي: أدخل أي بريد وكلمة مرور (8 أحرف) — لا يتم التحقق أو الإرسال لأي خادم.</p></div>
        {f.err && <div className="verdict worse small" role="alert">✕ {f.err}</div>}
        <Field label="البريد الإلكتروني" type="email" dir="ltr" autoComplete="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} error={eErr} />
        <Field label="كلمة المرور" type="password" dir="ltr" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} error={pErr} />
        <Button type="button" variant="ghost" onClick={() => go("recovery")}>نسيت كلمة المرور؟</Button>
        <Button variant="primary" type="submit" loading={f.busy} block>تسجيل الدخول</Button>
        <Button type="button" block onClick={() => go("register")}>ليس لديك حساب؟ إنشاء حساب</Button>
        <Button type="button" variant="ghost" block onClick={() => { setGuest(true); go("guest"); }}>متابعة كزائر</Button>
      </form>
    </AuthFrame>
  );
}

export function passwordIssues(pw: string) {
  const out: string[] = [];
  if (pw.length < 8) out.push("8 أحرف على الأقل");
  if (!/[0-9]/.test(pw)) out.push("رقم واحد على الأقل");
  if (!/[A-Za-z؀-ۿ]/.test(pw)) out.push("حرف واحد على الأقل");
  return out;
}

export function Register() {
  const { setUser, toast } = useApp();
  const [v, setV] = useState({ name: "", email: "", pw: "", pw2: "", agree: false });
  const [touched, setTouched] = useState(false);
  const f = useAuthForm();
  const issues = passwordIssues(v.pw);
  const errs = {
    name: v.name.trim().length < 2 ? "أدخل اسمك" : undefined,
    email: !EMAIL_RE.test(v.email) ? "أدخل بريدًا إلكترونيًا صحيحًا" : undefined,
    pw: issues.length ? "يجب أن تحتوي: " + issues.join("، ") : undefined,
    pw2: v.pw2 !== v.pw ? "كلمتا المرور غير متطابقتين" : undefined,
    agree: !v.agree ? "يلزم الموافقة للمتابعة" : undefined,
  };
  const ok = Object.values(errs).every((x) => !x);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (!ok) return;
    f.setBusy(true); f.setErr(null);
    try {
      const u = await api.register(v.name, v.email, v.pw);
      setUser(u); toast("تم إنشاء حسابك", "ok"); go("dashboard");
    } catch (x) { f.setErr(x instanceof ApiError ? x.message : "تعذّر إنشاء الحساب"); }
    finally { f.setBusy(false); }
  };
  const t = (k: keyof typeof errs) => (touched ? errs[k] : undefined);
  return (
    <AuthFrame back="login">
      <form className="col auth-form" onSubmit={submit} noValidate style={{ gap: 14, margin: "0 auto" }}>
        <div><h1 className="h1">إنشاء حساب</h1><p className="muted">احفظ مشاريعك ونتائج المحاكاة في مكان واحد.</p><p className="tiny muted">عرض توضيحي: الحساب والبيانات تُحفظ في متصفحك فقط.</p></div>
        {f.err && <div className="verdict worse small" role="alert">✕ {f.err}</div>}
        <Field label="الاسم" autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={t("name")} />
        <Field label="البريد الإلكتروني" type="email" dir="ltr" autoComplete="email" placeholder="name@example.com" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={t("email")} />
        <Field label="كلمة المرور" type="password" dir="ltr" autoComplete="new-password" value={v.pw} onChange={(e) => setV({ ...v, pw: e.target.value })} error={t("pw")} hint="8 أحرف على الأقل تتضمن حرفًا ورقمًا" />
        <Field label="تأكيد كلمة المرور" type="password" dir="ltr" autoComplete="new-password" value={v.pw2} onChange={(e) => setV({ ...v, pw2: e.target.value })} error={t("pw2")} />
        <label className="check"><input type="checkbox" checked={v.agree} onChange={(e) => setV({ ...v, agree: e.target.checked })} />أفهم أن النتائج توضيحية ولا تُستخدم لاتخاذ قرارات تشغيلية فعلية</label>
        {t("agree") && <span className="err">{errs.agree}</span>}
        <Button variant="primary" type="submit" loading={f.busy} block>إنشاء الحساب</Button>
        <Button type="button" variant="ghost" block onClick={() => go("login")}>لديك حساب؟ تسجيل الدخول</Button>
      </form>
    </AuthFrame>
  );
}

export function Recovery() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const f = useAuthForm();
  const err = touched && !EMAIL_RE.test(email) ? "أدخل بريدًا إلكترونيًا صحيحًا" : undefined;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (!EMAIL_RE.test(email)) return;
    f.setBusy(true);
    try { await api.requestReset(email); setSent(true); } catch { f.setErr("تعذّر إرسال الطلب، حاول مجددًا"); } finally { f.setBusy(false); }
  };
  return (
    <AuthFrame back="login">
      <form className="col auth-form" onSubmit={submit} noValidate style={{ gap: 16, margin: "0 auto" }}>
        <div><h1 className="h1">استعادة كلمة المرور</h1><p className="muted">أدخل بريدك وسنرسل رابط إعادة التعيين إن كان مسجّلًا.</p></div>
        {sent ? (
          <div className="verdict better" role="status">
            <span>✓</span>
            <div><strong>تم استلام الطلب</strong><div className="small secondary">إن كان البريد مسجّلًا ستصلك رسالة خلال دقائق. (عرض توضيحي: لا تُرسل رسائل فعلية)</div></div>
          </div>
        ) : (
          <>
            {f.err && <div className="verdict worse small">{f.err}</div>}
            <Field label="البريد الإلكتروني" type="email" dir="ltr" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} error={err} />
            <Button variant="primary" type="submit" loading={f.busy} block>إرسال رابط الاستعادة</Button>
          </>
        )}
        <Button type="button" variant="ghost" block onClick={() => go("login")}>العودة لتسجيل الدخول</Button>
      </form>
    </AuthFrame>
  );
}
