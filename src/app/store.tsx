import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../data/api";
import type { Project, User } from "../data/types";
import { DEFAULT_CONFIG, SimConfig } from "../sim/engine";
import { DEFAULT_LAYOUT, Layout } from "../sim/layout";

/* ── hash router: plain #name or #name-id (artifact-safe) ── */
export type Route = { name: string; id?: string };
const WITH_ID = ["project", "report", "studio"];
export function parseHash(h = location.hash): Route {
  const s = decodeURIComponent(h.replace(/^#/, ""));
  if (s === "project-new") return { name: s };
  for (const n of WITH_ID) if (s.startsWith(n + "-")) return { name: n, id: s.slice(n.length + 1) };
  return { name: s || "" };
}
export function go(name: string, id?: string) {
  const h = "#" + name + (id ? "-" + id : "");
  if (location.hash === h) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = h;
}
export function useRoute(): Route {
  const [r, setR] = useState(parseHash());
  useEffect(() => {
    const f = () => { setR(parseHash()); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return r;
}

type Toast = { id: number; text: string; tone?: "ok" | "bad" };
type Ctx = {
  user: User | null;
  ready: boolean;
  guest: boolean;
  setGuest(v: boolean): void;
  setUser(u: User | null): void;
  toast(text: string, tone?: "ok" | "bad"): void;
  toasts: Toast[];
  projects: Project[];
  refreshProjects(): Promise<void>;
  activeId: string | null;
  setActiveId(id: string | null): void;
  active: Project | null;
  layout: Layout;
  scenario: SimConfig;
  setScenario(c: SimConfig): void;
};
const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);

const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [guest, setGuest] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveIdS] = useState<string | null>(ls.get("sabbaq.active"));
  const [scenario, setScenarioS] = useState<SimConfig>(DEFAULT_CONFIG);

  const toast = useCallback((text: string, tone?: "ok" | "bad") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const refreshProjects = useCallback(async () => {
    try { setProjects(await api.listProjects()); } catch { setProjects([]); }
  }, []);

  useEffect(() => {
    api.me().then((u) => setUser(u)).catch(() => setUser(null)).finally(() => setReady(true));
  }, []);
  useEffect(() => { if (user) refreshProjects(); else setProjects([]); }, [user, refreshProjects]);

  const active = useMemo(() => projects.find((p) => p.id === activeId) ?? projects[0] ?? null, [projects, activeId]);
  // switching project loads its saved scenario
  useEffect(() => { if (active) setScenarioS(active.config); }, [active?.id]);

  const setActiveId = (id: string | null) => { setActiveIdS(id); ls.set("sabbaq.active", id); };
  const setScenario = (c: SimConfig) => setScenarioS(c);

  const value: Ctx = {
    user, ready, guest, setGuest, setUser, toast, toasts, projects, refreshProjects,
    activeId: active?.id ?? null, setActiveId, active,
    layout: active?.layout ?? DEFAULT_LAYOUT,
    scenario, setScenario,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
