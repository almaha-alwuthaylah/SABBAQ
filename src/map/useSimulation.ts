import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_MOVE, AGENT_OUT, AGENT_TRAPPED, AGENT_WAIT, Frame, SimConfig, Simulation, hazardStateAt, openExitIds } from "../sim/engine";
import { Layout, DEFAULT_LAYOUT } from "../sim/layout";

export type Phase = "idle" | "running" | "paused" | "done";
export type LiveMetrics = {
  t: number;
  evacuated: number;
  trapped: number;
  waiting: number;
  moving: number;
  total: number;
  completion: number;
  congestion: number;
  exitsOpen: number;
  exitsTotal: number;
  evacTime: number | null;
  history: number[];
  hazardActive: boolean;
};
export type AgentView = { pos: Float32Array; state: Uint8Array; n: number; staffFrom: number };
export type RouteLine = { pts: [number, number][]; load: number };

const SIM_RATE = 5; // simulated seconds per real second at 1×

/** Follows the distance field from each room door to an exit. */
export function traceRoutes(sim: Simulation): RouteLine[] {
  const out: RouteLine[] = [];
  const C = 10;
  const seen = new Set<string>();
  for (const z of sim.layout.zones) {
    const sx = z.door ? z.door.x + z.door.w / 2 : z.rect.x + z.rect.w / 2;
    const sy = z.door ? z.door.y + z.door.h / 2 : z.rect.y + z.rect.h / 2;
    let cx = Math.floor(sx / C), cy = Math.floor(sy / C);
    const pts: [number, number][] = [[sx, sy]];
    for (let k = 0; k < 400; k++) {
      const f = sim.field[sim.idx(cx, cy)];
      if (f <= 0 || f >= 1e9) break;
      let bx = cx, by = cy, best = f;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = sim.field[sim.idx(cx + dx, cy + dy)];
        if (v < best) { best = v; bx = cx + dx; by = cy + dy; }
      }
      if (bx === cx && by === cy) break;
      cx = bx; cy = by;
      pts.push([cx * C + 5, cy * C + 5]);
    }
    if (sim.field[sim.idx(cx, cy)] > 0) continue;
    // simplify: keep points where direction changes
    const simp: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = simp[simp.length - 1], [bx, by] = pts[i], [nx, ny] = pts[i + 1];
      const d1 = Math.atan2(by - ay, bx - ax), d2 = Math.atan2(ny - by, nx - bx);
      if (Math.abs(d1 - d2) > 0.35) simp.push(pts[i]);
    }
    simp.push(pts[pts.length - 1]);
    const key = simp.map((p) => p.join(",")).join(";");
    if (seen.has(key)) continue;
    seen.add(key);
    let load = 0;
    for (const a of sim.agents) if (a.state <= AGENT_MOVE && z.rect.x <= a.x && a.x < z.rect.x + z.rect.w && z.rect.y <= a.y && a.y < z.rect.y + z.rect.h) load++;
    out.push({ pts: simp, load });
  }
  return out;
}

function frameAt(frames: Frame[], t: number): { a: Frame; b: Frame; k: number } | null {
  if (!frames.length) return null;
  let lo = 0, hi = frames.length - 1;
  if (t <= frames[0].t) return { a: frames[0], b: frames[0], k: 0 };
  if (t >= frames[hi].t) return { a: frames[hi], b: frames[hi], k: 0 };
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frames[m].t <= t) lo = m; else hi = m; }
  const a = frames[lo], b = frames[hi];
  return { a, b, k: (t - a.t) / (b.t - a.t || 1) };
}

export function useSimulation(cfg: SimConfig, layout: Layout = DEFAULT_LAYOUT) {
  const simRef = useRef<Simulation | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [speed, setSpeed] = useState(1);
  const [viewT, setViewT] = useState(0); // time being displayed
  const [replay, setReplay] = useState(false); // viewing recorded frames rather than live head
  const [routes, setRoutes] = useState<RouteLine[]>([]);
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [version, setVersion] = useState(0);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const speedRef = useRef(speed); speedRef.current = speed;
  const viewRef = useRef(0);
  const replayRef = useRef(false); replayRef.current = replay;
  const cfgKey = JSON.stringify(cfg);

  const build = useCallback(() => {
    const s = new Simulation(cfg, layout, { record: true });
    simRef.current = s;
    viewRef.current = 0;
    setViewT(0);
    setReplay(false);
    setRoutes(traceRoutes(s));
    setVersion((v) => v + 1);
    return s;
  }, [cfgKey, layout]);

  // rebuild preview whenever the configuration changes while idle
  useEffect(() => { build(); setPhase("idle"); }, [build]);

  const computeMetrics = useCallback((): LiveMetrics | null => {
    const s = simRef.current;
    if (!s) return null;
    const t = viewRef.current;
    let evacuated = 0, trapped = 0, waiting = 0, moving = 0;
    const live = !replayRef.current;
    if (live) {
      for (const a of s.agents) {
        if (a.state === AGENT_OUT) evacuated++; else if (a.state === AGENT_TRAPPED) trapped++; else if (a.state === AGENT_WAIT) waiting++; else moving++;
      }
    } else {
      const f = frameAt(s.frames, t);
      if (f) for (const st of f.a.state) { if (st === AGENT_OUT) evacuated++; else if (st === AGENT_TRAPPED) trapped++; else if (st === AGENT_WAIT) waiting++; else moving++; }
    }
    const hz = hazardStateAt(s.cfg, t, s.layout);
    const open = openExitIds(s.cfg, s.layout).filter((id) => id !== hz?.closedExit);
    const samples = s.samples.filter((x) => x.t <= t + 0.01);
    const lastS = samples[samples.length - 1];
    return {
      t, evacuated, trapped, waiting, moving, total: s.agents.length,
      completion: evacuated / s.agents.length,
      congestion: live ? lastS?.congestion ?? 0 : lastS?.congestion ?? 0,
      exitsOpen: open.length, exitsTotal: s.layout.exits.length,
      evacTime: s.done && (!replayRef.current || t >= s.t) ? s.evacTime : null,
      history: samples.map((x) => x.peakDensity),
      hazardActive: !!hz?.active,
    };
  }, []);

  // main loop
  useEffect(() => {
    let raf = 0, last = performance.now(), lastUi = 0, lastRoutes = -10;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = simRef.current;
      if (s && phaseRef.current === "running") {
        const target = viewRef.current + dt * SIM_RATE * speedRef.current;
        if (replayRef.current) {
          viewRef.current = Math.min(target, s.t);
          if (viewRef.current >= s.t) setReplay(false);
        } else {
          const t0 = performance.now();
          while (!s.done && s.t < target && performance.now() - t0 < 12) s.step();
          viewRef.current = s.t;
          if (s.t - lastRoutes >= 2) { setRoutes(traceRoutes(s)); lastRoutes = s.t; }
          if (s.done) { setPhase("done"); setRoutes(traceRoutes(s)); }
        }
      }
      if (now - lastUi > 120) { lastUi = now; setViewT(viewRef.current); setMetrics(computeMetrics()); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [computeMetrics]);

  /** agents to draw at the displayed time (interpolated when replaying) */
  const getAgents = useCallback((): AgentView | null => {
    const s = simRef.current;
    if (!s) return null;
    const n = s.agents.length;
    if (!replayRef.current) {
      const pos = new Float32Array(n * 2), state = new Uint8Array(n);
      s.agents.forEach((a, i) => { pos[i * 2] = a.x; pos[i * 2 + 1] = a.y; state[i] = a.state; });
      return { pos, state, n, staffFrom: s.cfg.passengers };
    }
    const f = frameAt(s.frames, viewRef.current);
    if (!f) return null;
    const pos = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++) pos[i] = f.a.pos[i] + (f.b.pos[i] - f.a.pos[i]) * f.k;
    return { pos, state: f.a.state, n, staffFrom: s.cfg.passengers };
  }, []);

  const api = useMemo(() => ({
    start() {
      if (phaseRef.current === "done") build();
      setPhase("running");
    },
    pause() { if (phaseRef.current === "running") setPhase("paused"); },
    resume() { setPhase("running"); },
    reset() { build(); setPhase("idle"); },
    /** run to completion instantly (used by "skip to result") */
    finish() {
      const s = simRef.current;
      if (!s) return;
      s.runToEnd();
      viewRef.current = s.t;
      setReplay(false);
      setRoutes(traceRoutes(s));
      setPhase("done");
    },
    seek(t: number) {
      const s = simRef.current;
      if (!s) return;
      if (t >= s.t) { if (!s.done) { s.advanceTo(t); setRoutes(traceRoutes(s)); } viewRef.current = s.t; setReplay(false); if (s.done) setPhase("done"); }
      else { viewRef.current = Math.max(0, t); setReplay(true); if (phaseRef.current === "idle") setPhase("paused"); }
      setViewT(viewRef.current);
      setMetrics(computeMetrics());
    },
  }), [build, computeMetrics]);

  const sim = simRef.current;
  return {
    sim, phase, speed, setSpeed, viewT, replay, routes, metrics, version, getAgents, ...api,
    duration: sim?.done ? sim.t : Math.max(240, (sim?.t ?? 0) + 60),
    recordedT: sim?.t ?? 0,
  };
}
