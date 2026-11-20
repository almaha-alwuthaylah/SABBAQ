import React, { Suspense } from "react";
import { AppProvider, go, useApp, useRoute } from "./store";
import { Shell } from "./Shell";
import { Loading } from "../ui/kit";
import { Login, Recovery, Register, Welcome } from "../screens/Auth";
import { Dashboard, NewProject, ProjectDetail, ProjectsList } from "../screens/Projects";
import { Lab } from "../screens/Lab";
import * as M from "../screens/Modules";
import { Studio } from "../screens/Studio";

const PUBLIC = ["welcome", "login", "register", "recovery", "guest"];

function Router() {
  const { user, ready, guest } = useApp();
  const r = useRoute();
  if (!ready) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Loading text="جارٍ تجهيز مساحة العمل…" /></div>;
  let name = r.name;
  if (!user && !PUBLIC.includes(name)) name = "welcome";
  if (user && ["welcome", "login", "register", "recovery", ""].includes(name)) name = "dashboard";
  if (name === "guest" && !user && !guest) { /* direct link to guest mode is allowed */ }
  if (name !== r.name) queueMicrotask(() => go(name));

  if (!user) {
    switch (name) {
      case "login": return <Login />;
      case "register": return <Register />;
      case "recovery": return <Recovery />;
      case "guest": return <Shellless><Lab guest /></Shellless>;
      default: return <Welcome />;
    }
  }
  const screens: Record<string, React.ReactNode> = {
    dashboard: <Dashboard />,
    projects: <ProjectsList />,
    "project-new": <NewProject />,
    project: r.id ? <ProjectDetail id={r.id} /> : <ProjectsList />,
    studio: <Studio />,
    lab: <Lab />,
    guest: <Lab />,
    stress: <M.Stress />,
    improve: <M.Improve />,
    compare: <M.Compare />,
    challenge: <M.Challenge />,
    duel: <M.Duel />,
    risk: <M.Risk />,
    robustness: <M.Robustness />,
    analytics: <M.Analytics />,
    history: <M.Analytics tab="history" />,
    reports: <M.Reports />,
    report: <M.ReportView id={r.id!} />,
    profile: <M.Profile />,
  };
  return <Shell route={name}><Suspense fallback={<Loading />}>{screens[name] ?? <Dashboard />}</Suspense></Shell>;
}

function Shellless({ children }: { children: React.ReactNode }) {
  const { toasts } = useApp();
  return (
    <div className="app">
      <main className="main" id="main">{children}</main>
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.tone ?? ""}`}>{t.text}</div>)}</div>
    </div>
  );
}

export function App() {
  return <AppProvider><Router /></AppProvider>;
}
