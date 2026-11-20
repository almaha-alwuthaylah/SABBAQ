import React, { useEffect, useId, useRef } from "react";
import { go } from "../app/store";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "go" | "danger" | "blue" | "ghost"; size?: "sm"; block?: boolean; loading?: boolean };
export function Button({ variant, size, block, loading, className = "", children, disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn ${variant ?? ""} ${size ?? ""} ${block ? "block" : ""} ${className}`} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading && <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />}
      {children}
    </button>
  );
}

export const Card = ({ className = "", children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`card ${className}`} {...rest}>{children}</div>
);

export function Field({ label, error, hint, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={`input ${error ? "invalid" : ""}`} aria-invalid={!!error} aria-describedby={error ? id + "e" : undefined} {...rest} />
      {error ? <span className="err" id={id + "e"} role="alert">{error}</span> : hint ? <span className="tiny muted">{hint}</span> : null}
    </div>
  );
}

export function SelectField({ label, value, onChange, options, small }: { label?: string; value: string; onChange(v: string): void; options: [string, string][]; small?: boolean }) {
  const id = useId();
  const sel = (
    <select id={id} className={`select ${small ? "sm" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  if (!label) return sel;
  return <div className="field"><label htmlFor={id}>{label}</label>{sel}</div>;
}

export function NumberField({ label, value, onChange, min = 0, max = 9999, step = 1, unit, disabled }: { label: string; value: number; onChange(v: number): void; min?: number; max?: number; step?: number; unit?: string; disabled?: boolean }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  const fix = (v: number) => +clamp(v).toFixed(step < 1 ? 1 : 0);
  return (
    <div className="numfield">
      <span className="lbl">{label}</span>
      <div className="ctl" dir="ltr">
        <button type="button" aria-label={`إنقاص ${label}`} disabled={disabled || value <= min} onClick={() => onChange(fix(value - step))}>−</button>
        <input aria-label={label} inputMode="decimal" value={value} disabled={disabled}
          onChange={(e) => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) onChange(fix(n)); }} />
        {unit && <span className="tiny muted" style={{ paddingInlineEnd: 4 }}>{unit}</span>}
        <button type="button" aria-label={`زيادة ${label}`} disabled={disabled || value >= max} onClick={() => onChange(fix(value + step))}>+</button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange(v: T): void; items: [T, string][] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? "active" : ""} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export const Chip = ({ tone = "gray", children }: { tone?: "green" | "red" | "yellow" | "orange" | "gray"; children: React.ReactNode }) => <span className={`chip ${tone}`}>{children}</span>;

export function Modal({ title, children, onClose, actions }: { title: string; children: React.ReactNode; onClose(): void; actions?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, input, [href]")?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); prev?.focus?.(); };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 className="h2">{title}</h2>
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon = "◇", title, text, action }: { icon?: string; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="state">
      <div className="ico" aria-hidden>{icon}</div>
      <strong style={{ color: "var(--text)" }}>{title}</strong>
      {text && <span className="small">{text}</span>}
      {action}
    </div>
  );
}

export function ErrorState({ text, retry }: { text: string; retry?(): void }) {
  return (
    <div className="state" role="alert">
      <div className="ico" style={{ color: "var(--red)", borderColor: "#8a2f4a" }}>!</div>
      <strong style={{ color: "var(--text)" }}>تعذّر تحميل البيانات</strong>
      <span className="small">{text}</span>
      {retry && <Button size="sm" onClick={retry}>إعادة المحاولة</Button>}
    </div>
  );
}

export const Loading = ({ text = "جارٍ التحميل…" }: { text?: string }) => (
  <div className="state" aria-live="polite"><span className="spinner" /><span className="small">{text}</span></div>
);

export function PageHead({ crumbs, title, subtitle, actions, status }: { crumbs?: [string, string?][]; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; status?: React.ReactNode }) {
  return (
    <div className="col" style={{ gap: 8 }}>
      {crumbs && (
        <nav className="crumbs" aria-label="مسار التنقل">
          {crumbs.map(([l, h], i) => (
            <React.Fragment key={i}>
              {i > 0 && <span>/</span>}
              {h ? <a href={"#" + h}>{l}</a> : <span>{l}</span>}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="page-head">
        <div className="row" style={{ gap: 20 }}>
          <h1 className="h1">{title}</h1>
          {status}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
      <div className="disclaimer">{subtitle ?? "بيانات توضيحية • منشأة خيالية • النتائج ليست تقييمًا هندسيًا معتمدًا"}</div>
    </div>
  );
}

export const Metric = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "green" | "red" | "yellow" }) => (
  <div className="metric"><span className="k">{k}</span><span className={`v num ${tone ?? ""}`}>{v}</span></div>
);

export const Stat = ({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) => (
  <Card className="stat"><div className="k">{k}</div><div className="v num">{v}</div>{sub && <div className="small muted">{sub}</div>}</Card>
);

export function Spark({ data, color = "var(--yellow)", height = 90, max, labels }: { data: number[]; color?: string; height?: number; max?: number; labels?: [string, string] }) {
  const W = 200, H = 60;
  const m = max ?? Math.max(1, ...data);
  const pts = data.map((v, i) => `${data.length < 2 ? 0 : (i / (data.length - 1)) * W},${H - (v / m) * (H - 4) - 2}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height, transform: "scaleX(-1)" }} preserveAspectRatio="none" role="img" aria-label="منحنى زمني">
        {[0.25, 0.5, 0.75].map((y) => <line key={y} x1="0" x2={W} y1={H * y} y2={H * y} stroke="#1d3b58" strokeWidth="1" />)}
        {data.length > 1 && <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
      </svg>
      {labels && <div className="row tiny muted num" style={{ justifyContent: "space-between" }}><span>{labels[0]}</span><span>{labels[1]}</span></div>}
    </div>
  );
}

export const fmtTime = (s: number | null | undefined) => {
  if (s === null || s === undefined || !isFinite(s)) return "—";
  const t = Math.max(0, Math.round(s));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "short", day: "numeric" });

export const Link = ({ to, id, children, className }: { to: string; id?: string; children: React.ReactNode; className?: string }) => (
  <a href={`#${to}${id ? "-" + id : ""}`} className={className} onClick={(e) => { e.preventDefault(); go(to, id); }}>{children}</a>
);

export function Logo({ size = 1 }: { size?: number }) {
  return (
    <div className="row" style={{ gap: 10 * size, flexWrap: "nowrap" }} aria-label="سَبّاق SABBAQ">
      <svg width={44 * size} height={28 * size} viewBox="0 0 44 28" aria-hidden>
        <path d="M2 22 L30 4 L22 13 L42 7 L14 26 L22 16 Z" fill="var(--red)" />
      </svg>
      <span style={{ fontWeight: 800, fontSize: 26 * size, letterSpacing: 0 }}>سَبّاق</span>
      <span style={{ width: 1, height: 22 * size, background: "var(--border)" }} />
      <span style={{ fontWeight: 700, fontSize: 15 * size, letterSpacing: 1.5 }}>SABBAQ</span>
    </div>
  );
}
