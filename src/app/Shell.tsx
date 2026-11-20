import React, { useEffect, useState } from "react";
import { go, useApp } from "./store";
import { Logo } from "../ui/kit";

export const NAV: { id: string; label: string; icon: string; match?: string[] }[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "◫" },
  { id: "projects", label: "مشاريعي", icon: "▤", match: ["projects", "project", "project-new"] },
  { id: "studio", label: "استوديو المخطط", icon: "✎" },
  { id: "lab", label: "مختبر المحاكاة", icon: "▶" },
  { id: "stress", label: "اكسر خطتي", icon: "⚡" },
  { id: "improve", label: "أنقذ الخطة", icon: "✚" },
  { id: "compare", label: "المقارنة", icon: "⇄" },
  { id: "challenge", label: "تحدّي الحلول", icon: "♟" },
  { id: "duel", label: "مواجهة الحلول", icon: "⚔" },
  { id: "risk", label: "عدسة الخطر", icon: "◎" },
  { id: "robustness", label: "اختبار التحمّل", icon: "≋" },
  { id: "analytics", label: "النتائج والتحليلات", icon: "▥", match: ["analytics", "history"] },
  { id: "reports", label: "التقارير", icon: "▦", match: ["reports", "report"] },
];
const TOP = [
  { id: "dashboard", label: "مساحة العمل", match: ["dashboard"] },
  { id: "projects", label: "المشاريع", match: ["projects", "project", "project-new", "studio"] },
  { id: "lab", label: "المحاكاة", match: ["lab", "stress", "improve", "compare", "challenge", "duel", "risk", "robustness"] },
  { id: "reports", label: "التقارير", match: ["reports", "report", "analytics", "history"] },
  { id: "profile", label: "الحساب", match: ["profile"] },
];

export function Shell({ route, children }: { route: string; children: React.ReactNode }) {
  const { active, user, toasts } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [route]);
  const isOn = (n: { id: string; match?: string[] }) => (n.match ?? [n.id]).includes(route);
  return (
    <div className="app">
      <a href="#main" className="sr-only">تخطَّ إلى المحتوى</a>
      <header className="topbar">
        <a href="#dashboard" style={{ color: "inherit", textDecoration: "none" }}><Logo size={0.85} /></a>
        <nav className="topnav" aria-label="التنقل الرئيسي">
          {TOP.map((n) => <a key={n.id} href={"#" + n.id} className={isOn(n) ? "active" : ""}>{n.label}</a>)}
        </nav>
        <span className="env">بيئة تجريبية · {active ? active.name : "لا يوجد مشروع"}</span>
        <button className="btn ghost menu-btn icon-btn" aria-label="القائمة" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
      </header>
      <div className="body">
        <aside className={`sidebar ${open ? "open" : ""}`} aria-label="أقسام المنصة">
          <div className="label">مساحة العمل</div>
          {NAV.map((n) => (
            <a key={n.id} href={"#" + n.id} className={isOn(n) ? "active" : ""} aria-current={isOn(n) ? "page" : undefined}>
              <span aria-hidden style={{ width: 18, textAlign: "center", opacity: 0.8 }}>{n.icon}</span>{n.label}
            </a>
          ))}
          <div className="foot">
            <a href="#profile" style={{ background: "none", padding: "8px 0" }}>{user?.name} · الخصوصية والإعدادات</a>
            <div>قرارات أكثر استعدادًا</div>
          </div>
        </aside>
        <main className="main" id="main">{children}</main>
      </div>
      <nav className="mobile-nav" aria-label="تنقل الجوال">
        {[["dashboard", "الرئيسية", "◫"], ["projects", "المشاريع", "▤"], ["lab", "المحاكاة", "▶"], ["compare", "المقارنة", "⇄"], ["profile", "الحساب", "◉"]].map(([id, l, i]) => (
          <a key={id} href={"#" + id} className={route === id ? "active" : ""}><span className="i">{i}</span>{l}</a>
        ))}
      </nav>
      <Toasts toasts={toasts} />
    </div>
  );
}

export const Toasts = ({ toasts }: { toasts: { id: number; text: string; tone?: string }[] }) => (
  <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.tone ?? ""}`}>{t.text}</div>)}</div>
);

export function requireProject(active: unknown) {
  if (!active) { go("projects"); return false; }
  return true;
}
