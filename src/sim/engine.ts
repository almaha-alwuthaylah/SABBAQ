// SABBAQ evacuation engine — deterministic, UI-independent.
// Model (illustrative, not validated):
//  • 1 m² walkable grid rasterised from the layout.
//  • Route choice: Dijkstra distance field to all open egress points, re-computed every
//    REPLAN_S seconds with hazard penalties and a crowd-avoidance term (people avoid dense cells).
//  • Walking speed: Weidmann fundamental diagram v = v0·(1 − e^(−1.913·(1/ρ − 1/5.4))).
//  • Egress capacity: specific flow 1.33 persons/(m·s) per exit width (SFPE-style constant).
//  • Pre-movement delay: seeded log-normal around a mean reduced by staff guidance.
// Same config + seed ⇒ identical results.

import { DEFAULT_LAYOUT, Layout, Rect, inRect, center, zoneById } from "./layout";
import { mulberry32, lognormal } from "./rng";

export type HazardType = "fire" | "gas" | "electrical" | "crowd" | "operational" | "closure";
export type Distribution = "balanced" | "gates" | "concourse";

export type Hazard = { type: HazardType; zoneId: string; at: number; point?: { x: number; y: number } };

export type Modifiers = {
  widenDoors?: string[]; // zone ids whose doors are doubled in width
  openExits?: string[]; // exits forced open regardless of counts
  guidance?: boolean; // staff actively redistribute people across exits
  extraMarshals?: number; // added staff (reduces response time)
  closeExits?: string[]; // forced closures (stress tests)
};

export type SimConfig = {
  seed: number;
  passengers: number;
  staff: number;
  entrances: number; // 0..2 main-entrance doors usable for egress
  exits: number; // 1..4 total of E1..E4 open
  emergencyExits: number; // 0..2 of the open exits that are emergency exits
  distribution: Distribution;
  speed: number; // free walking speed m/s
  hazard?: Hazard | null;
  modifiers?: Modifiers;
};

export const DEFAULT_CONFIG: SimConfig = {
  seed: 7,
  passengers: 480,
  staff: 20,
  entrances: 2,
  exits: 4,
  emergencyExits: 2,
  distribution: "balanced",
  speed: 1.2,
  hazard: null,
};

export const HAZARD_LABELS: Record<HazardType, string> = {
  fire: "حريق",
  gas: "تسرّب غاز",
  electrical: "تماس كهربائي",
  crowd: "ازدحام",
  operational: "خطر تشغيلي",
  closure: "إغلاق ممر",
};

export const AGENT_WAIT = 0, AGENT_MOVE = 1, AGENT_OUT = 2, AGENT_TRAPPED = 3;

const CELL = 10; // units per cell (1 m)
const DT = 0.1;
const REPLAN_S = 2;
const FRAME_S = 0.5;
const MAX_T = 900;
const SPECIFIC_FLOW = 1.33;
const INF = 1e9;
const MAX_PER_CELL = 5; // ≈ 5 persons/m² physical limit

type Egress = { id: string; rect: Rect; capacity: number; tokens: number; open: boolean; kind: "exit" | "entrance"; count: number };

export type HazardState = { active: boolean; x: number; y: number; radius: number; halo: number; type: HazardType; closedExit?: string; closedRect?: Rect; speedFactor: number; exposureLimit: number };

export function hazardStateAt(cfg: SimConfig, t: number, layout: Layout = DEFAULT_LAYOUT): HazardState | null {
  const h = cfg.hazard;
  if (!h) return null;
  const z = zoneById(layout, h.zoneId);
  const p = h.point ?? (z ? center(z.rect) : { x: 480, y: 265 });
  const since = t - h.at;
  const active = since >= 0;
  const s = Math.max(0, since);
  const base: HazardState = { active, x: p.x, y: p.y, radius: 0, halo: 0, type: h.type, speedFactor: 1, exposureLimit: INF };
  switch (h.type) {
    case "fire":
      return { ...base, radius: active ? Math.min(120, 30 + s * 0.75) : 0, halo: active ? Math.min(170, 60 + s * 0.9) : 0, speedFactor: 0.55, exposureLimit: 18 };
    case "gas":
      return { ...base, radius: active ? Math.min(160, 40 + s * 0.5) : 0, halo: active ? Math.min(230, 80 + s * 0.7) : 0, speedFactor: 0.7, exposureLimit: 35 };
    case "electrical":
      return { ...base, radius: active ? 40 : 0, halo: active ? 70 : 0, speedFactor: 0.8, exposureLimit: 25 };
    case "crowd":
      return { ...base, radius: 0, halo: active ? 90 : 0, speedFactor: 0.5, exposureLimit: INF };
    case "operational": {
      // closes the exit nearest to the chosen location
      let best = layout.exits[0], bd = INF;
      for (const e of layout.exits) {
        const c = center(e.rect), d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bd) { bd = d; best = e; }
      }
      return { ...base, closedExit: active ? best.id : undefined, halo: active ? 40 : 0 };
    }
    case "closure": {
      const r = z?.door ?? { x: p.x - 15, y: 210, w: 30, h: 110 };
      return { ...base, closedRect: active ? r : undefined, halo: active ? 30 : 0 };
    }
  }
}

export function openExitIds(cfg: SimConfig, layout: Layout = DEFAULT_LAYOUT): string[] {
  const total = Math.max(0, Math.min(4, cfg.exits));
  const em = Math.max(0, Math.min(2, cfg.emergencyExits, total));
  const reg = Math.min(2, total - em);
  const ids = [
    ...layout.exits.filter((e) => !e.emergency).slice(0, reg),
    ...layout.exits.filter((e) => e.emergency).slice(0, em),
  ].map((e) => e.id);
  for (const id of cfg.modifiers?.openExits ?? []) if (!ids.includes(id)) ids.push(id);
  return ids.filter((id) => !(cfg.modifiers?.closeExits ?? []).includes(id));
}

export type Frame = { t: number; pos: Float32Array; state: Uint8Array };
export type Sample = { t: number; completion: number; peakDensity: number; congestion: number; evacuated: number };

export type SimSummary = {
  evacTime: number | null; // s until last reachable person is out (null if never)
  completion: number; // 0..1
  evacuated: number;
  trapped: number;
  total: number;
  peakDensity: number; // persons / m²
  maxCongestionPoints: number;
  exitUsage: Record<string, number>;
  alarmAt: number;
  endT: number;
};

type Agent = { x: number; y: number; start: number; state: number; exposure: number; lane: number; v0: number; staff: boolean };

export class Simulation {
  readonly cfg: SimConfig;
  readonly layout: Layout;
  readonly cols: number;
  readonly rows: number;
  t = 0;
  agents: Agent[] = [];
  egress: Egress[] = [];
  walk: Uint8Array;
  field: Float64Array;
  density: Float32Array;
  occ: Uint16Array;
  frames: Frame[] = [];
  samples: Sample[] = [];
  done = false;
  alarmAt: number;
  peakDensity = 0;
  maxCongestion = 0;
  congestionCells: number[] = [];
  evacTime: number | null = null;
  private rng: () => number;
  private nextReplan = 0;
  private nextFrame = 0;
  private nextSample = 0;
  private doorBlocks: Rect[] = [];

  constructor(cfg: SimConfig, layout: Layout = DEFAULT_LAYOUT, opts: { record?: boolean } = {}) {
    this.cfg = cfg;
    this.layout = layout;
    this.cols = Math.ceil(layout.width / CELL);
    this.rows = Math.ceil(layout.height / CELL);
    const n = this.cols * this.rows;
    this.walk = new Uint8Array(n);
    this.field = new Float64Array(n).fill(INF);
    this.density = new Float32Array(n);
    this.occ = new Uint16Array(n);
    this.rng = mulberry32(cfg.seed >>> 0);
    this.alarmAt = cfg.hazard ? Math.max(0, cfg.hazard.at) : 0;
    this.record = opts.record ?? false;
    this.buildGrid();
    this.spawn();
    for (const a of this.agents) this.occ[this.cellOf(a.x, a.y)]++;
    this.replan();
    this.capture();
  }
  private record: boolean;

  idx(cx: number, cy: number) { return cy * this.cols + cx; }
  cellOf(x: number, y: number) { return this.idx(Math.floor(x / CELL), Math.floor(y / CELL)); }

  private buildGrid() {
    const L = this.layout, mods = this.cfg.modifiers ?? {};
    const mark = (r: Rect, v: number) => {
      // a cell is walkable when its centre lies inside the space; gaps between rooms become walls
      for (let cy = 0; cy < this.rows; cy++)
        for (let cx = 0; cx < this.cols; cx++)
          if (inRect(r, cx * CELL + CELL / 2, cy * CELL + CELL / 2)) this.walk[this.idx(cx, cy)] = v;
    };
    for (const z of L.zones) mark(z.rect, 1);
    for (const z of L.zones) if (z.door) {
      const wide = mods.widenDoors?.includes(z.id);
      const d = wide ? { ...z.door, x: z.door.x - z.door.w / 2, w: z.door.w * 2 } : z.door;
      mark(d, 1);
    }
    const open = openExitIds(this.cfg, L);
    for (const e of L.exits) {
      const isOpen = open.includes(e.id);
      this.egress.push({ id: e.id, rect: e.rect, capacity: e.widthM * SPECIFIC_FLOW, tokens: 1, open: isOpen, kind: "exit", count: 0 });
      mark(e.rect, 1);
    }
    if (this.cfg.entrances > 0) {
      const r = L.mainEntrance;
      this.egress.push({ id: "ME", rect: r, capacity: 1.2 * this.cfg.entrances * SPECIFIC_FLOW, tokens: 1, open: true, kind: "entrance", count: 0 });
      mark(r, 1);
    }
  }

  private spawn() {
    const { passengers, staff, distribution } = this.cfg;
    const zones = this.layout.zones;
    const w = zones.map((z) => {
      const m = distribution === "gates" ? (z.kind === "gate" ? 2.2 : 0.5) : distribution === "concourse" ? (z.kind === "concourse" ? 3 : 0.5) : 1;
      return z.capacityWeight * m * (z.rect.w * z.rect.h) / 10000;
    });
    const sum = w.reduce((a, b) => a + b, 0);
    const meanResp = 32 * (1 - Math.min(0.6, ((staff + (this.cfg.modifiers?.extraMarshals ?? 0)) / Math.max(1, passengers)) * 3));
    const total = passengers + staff;
    for (let i = 0; i < total; i++) {
      let r = this.rng() * sum, zi = 0;
      while (zi < w.length - 1 && r > w[zi]) { r -= w[zi]; zi++; }
      const rc = zones[zi].rect;
      let x = 0, y = 0;
      for (let k = 0; k < 20; k++) {
        x = rc.x + 12 + this.rng() * (rc.w - 24);
        y = rc.y + 12 + this.rng() * (rc.h - 24);
        if (this.walk[this.cellOf(x, y)]) break;
      }
      const isStaff = i >= passengers;
      const resp = isStaff ? 5 + this.rng() * 10 : lognormal(this.rng, meanResp, 0.3);
      const v0 = this.cfg.speed * (0.8 + this.rng() * 0.4) * (isStaff ? 1.05 : 1);
      this.agents.push({ x, y, start: this.alarmAt + resp, state: AGENT_WAIT, exposure: 0, lane: (this.rng() - 0.5) * 6, v0, staff: isStaff });
    }
  }

  private isBlocked(i: number, hz: HazardState | null): boolean {
    if (!this.walk[i]) return true;
    if (!hz || !hz.active) return false;
    const cx = (i % this.cols) * CELL + CELL / 2, cy = Math.floor(i / this.cols) * CELL + CELL / 2;
    if (hz.closedRect && inRect(hz.closedRect, cx, cy)) return true;
    return false;
  }

  private hazardPenalty(cx: number, cy: number, hz: HazardState | null): number {
    if (!hz || !hz.active) return 0;
    const d = Math.hypot(cx - hz.x, cy - hz.y);
    if (hz.radius > 0 && d < hz.radius) return 60;
    if (hz.halo > 0 && d < hz.halo) return hz.type === "crowd" ? 3 : 8 * (1 - d / hz.halo) + 1;
    return 0;
  }

  replan() {
    const hz = hazardStateAt(this.cfg, this.t, this.layout);
    const n = this.cols * this.rows;
    const f = this.field;
    f.fill(INF);
    const heap = new MinHeap();
    for (const e of this.egress) {
      e.open = e.kind === "entrance" ? true : openExitIds(this.cfg, this.layout).includes(e.id);
      if (hz?.closedExit === e.id) e.open = false;
      if (!e.open) continue;
      // seed sinks: cells of the exit rect lying outside the building outline
      const r = e.rect;
      for (let cy = Math.floor(r.y / CELL); cy < Math.ceil((r.y + r.h) / CELL); cy++)
        for (let cx = Math.floor(r.x / CELL); cx < Math.ceil((r.x + r.w) / CELL); cx++) {
          const i = this.idx(cx, cy);
          if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows || !this.walk[i]) continue;
          const px = cx * CELL + 5, py = cy * CELL + 5;
          if (this.layout.zones.some((z) => inRect(z.rect, px, py))) continue; // sinks lie outside rooms
          f[i] = 0;
          heap.push(i, 0);
        }
    }
    const guidanceW = this.cfg.modifiers?.guidance ? 1.6 : 0.35;
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (heap.size) {
      const [i, d] = heap.pop();
      if (d > f[i]) continue;
      const cx = i % this.cols, cy = (i / this.cols) | 0;
      for (const [dx, dy, c] of D) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const j = this.idx(nx, ny);
        if (this.isBlocked(j, hz)) continue;
        if (dx && dy && (this.isBlocked(this.idx(cx + dx, cy), hz) || this.isBlocked(this.idx(cx, cy + dy), hz))) continue;
        const pen = this.hazardPenalty(nx * CELL + 5, ny * CELL + 5, hz);
        const nd = d + c * (1 + pen + guidanceW * Math.max(0, this.density[j] - 1));
        if (nd < f[j]) { f[j] = nd; heap.push(j, nd); }
      }
    }
    void n;
  }

  private updateDensity() {
    const raw = new Float32Array(this.density.length);
    for (const a of this.agents) if (a.state <= AGENT_MOVE) raw[this.cellOf(a.x, a.y)] += 1;
    // 3x3 smoothing → persons per m²
    const d = this.density;
    let peak = 0;
    const cong: number[] = [];
    for (let cy = 0; cy < this.rows; cy++)
      for (let cx = 0; cx < this.cols; cx++) {
        let s = 0, k = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const x = cx + ox, y = cy + oy;
          if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
          const j = this.idx(x, y);
          if (!this.walk[j]) continue;
          s += raw[j]; k++;
        }
        const i = this.idx(cx, cy);
        d[i] = k ? s / k : 0;
        if (d[i] > peak) peak = d[i];
        if (d[i] >= 2) cong.push(i);
      }
    this.congestionCells = cong;
    this.peakDensity = Math.max(this.peakDensity, peak);
    return { peak, clusters: this.countClusters(cong) };
  }

  private countClusters(cells: number[]): number {
    const set = new Set(cells), seen = new Set<number>();
    let n = 0;
    for (const c of cells) {
      if (seen.has(c)) continue;
      let size = 0;
      const st = [c];
      seen.add(c);
      while (st.length) {
        const i = st.pop()!;
        size++;
        const cx = i % this.cols, cy = (i / this.cols) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = this.idx(cx + dx, cy + dy);
          if (set.has(j) && !seen.has(j)) { seen.add(j); st.push(j); }
        }
      }
      if (size >= 3) n++;
    }
    return n;
  }

  private gradient(x: number, y: number): [number, number] {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let best = this.field[this.idx(cx, cy)], bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
      const v = this.field[this.idx(nx, ny)];
      if (v < best) { best = v; bx = dx; by = dy; }
    }
    if (!bx && !by) return [0, 0];
    // aim at neighbouring cell centre for smooth motion
    const tx = (cx + bx) * CELL + CELL / 2 - x, ty = (cy + by) * CELL + CELL / 2 - y;
    const m = Math.hypot(tx, ty) || 1;
    return [tx / m, ty / m];
  }

  step(): void {
    if (this.done) return;
    const hz = hazardStateAt(this.cfg, this.t, this.layout);
    if (this.t >= this.nextReplan) {
      const { peak, clusters } = this.updateDensity();
      this.maxCongestion = Math.max(this.maxCongestion, clusters);
      this.replan();
      this.nextReplan = this.t + REPLAN_S;
      if (this.t >= this.nextSample) {
        const s = this.summaryCounts();
        this.samples.push({ t: this.t, completion: s.evacuated / this.agents.length, peakDensity: peak, congestion: clusters, evacuated: s.evacuated });
        this.nextSample = this.t + 5;
      }
    }
    for (const e of this.egress) e.tokens = Math.min(e.capacity, e.tokens + e.capacity * DT);

    for (const a of this.agents) {
      if (a.state >= AGENT_OUT) continue;
      // hazard proximity triggers immediate response
      if (hz?.active && a.state === AGENT_WAIT) {
        const d = Math.hypot(a.x - hz.x, a.y - hz.y);
        if (d < hz.halo + 40) a.start = Math.min(a.start, this.t);
      }
      if (a.state === AGENT_WAIT && this.t >= a.start) a.state = AGENT_MOVE;
      if (a.state === AGENT_WAIT) continue;

      const ci = this.cellOf(a.x, a.y);
      // exposure
      let sf = 1;
      if (hz?.active) {
        const d = Math.hypot(a.x - hz.x, a.y - hz.y);
        if (hz.radius > 0 && d < hz.radius) a.exposure += DT;
        if (d < Math.max(hz.radius, hz.halo)) sf = hz.speedFactor;
        if (a.exposure > hz.exposureLimit) { a.state = AGENT_TRAPPED; this.occ[this.cellOf(a.x, a.y)]--; continue; }
      }
      // reached egress?
      const eg = this.field[ci] <= 1.5 ? this.egress.find((e) => e.open && inRect({ x: e.rect.x - CELL, y: e.rect.y - CELL, w: e.rect.w + 2 * CELL, h: e.rect.h + 2 * CELL }, a.x, a.y)) : undefined;
      if (eg && this.field[ci] <= 1.5) {
        if (eg.tokens >= 1) { eg.tokens -= 1; eg.count++; a.state = AGENT_OUT; this.occ[ci]--; continue; }
        continue; // queueing at the door
      }
      if (this.field[ci] >= INF) {
        // no route to any open egress
        if (this.t - a.start > 60) { a.state = AGENT_TRAPPED; this.occ[ci]--; }
        continue;
      }
      const [gx, gy] = this.gradient(a.x, a.y);
      const rho = Math.max(0.3, this.density[ci]);
      const vw = rho >= 5.4 ? 0.05 : Math.max(0.05, 1 - Math.exp(-1.913 * (1 / rho - 1 / 5.4)));
      const v = (a.v0 * vw * sf) / this.layout.unitM; // m/s → units/s
      // lateral lane offset gives natural spread along corridors
      const px = -gy * a.lane * 0.02, py = gx * a.lane * 0.02;
      const nx = a.x + (gx + px) * v * DT, ny = a.y + (gy + py) * v * DT;
      const ok = (x: number, y: number) => {
        const j = this.cellOf(x, y);
        return !this.isBlocked(j, hz) && (j === ci || this.occ[j] < MAX_PER_CELL);
      };
      let tx = a.x, ty = a.y;
      if (ok(nx, ny)) { tx = nx; ty = ny; }
      else if (ok(nx, a.y)) tx = nx;
      else if (ok(a.x, ny)) ty = ny;
      const nj = this.cellOf(tx, ty);
      if (nj !== ci) { this.occ[ci]--; this.occ[nj]++; }
      a.x = tx; a.y = ty;
    }

    this.t = Math.round((this.t + DT) * 1000) / 1000;
    const c = this.summaryCounts();
    if (c.active === 0 && this.evacTime === null && c.evacuated > 0) this.evacTime = this.t - this.alarmAt;
    if (c.active === 0 || this.t >= MAX_T) {
      this.done = true;
      this.updateDensity();
      this.samples.push({ t: this.t, completion: c.evacuated / this.agents.length, peakDensity: 0, congestion: 0, evacuated: c.evacuated });
    }
    if (this.t >= this.nextFrame || this.done) this.capture();
  }

  private capture() {
    if (!this.record) return;
    const n = this.agents.length;
    const pos = new Float32Array(n * 2), state = new Uint8Array(n);
    this.agents.forEach((a, i) => { pos[i * 2] = a.x; pos[i * 2 + 1] = a.y; state[i] = a.state; });
    this.frames.push({ t: this.t, pos, state });
    this.nextFrame = this.t + FRAME_S;
  }

  summaryCounts() {
    let evacuated = 0, trapped = 0, active = 0;
    for (const a of this.agents) {
      if (a.state === AGENT_OUT) evacuated++;
      else if (a.state === AGENT_TRAPPED) trapped++;
      else active++;
    }
    return { evacuated, trapped, active };
  }

  /** advance until sim time ≥ t (or done) */
  advanceTo(t: number) { while (!this.done && this.t < t) this.step(); }
  runToEnd() { while (!this.done) this.step(); return this.summary(); }

  summary(): SimSummary {
    const c = this.summaryCounts();
    const usage: Record<string, number> = {};
    for (const e of this.egress) usage[e.id] = e.count;
    return {
      evacTime: this.evacTime,
      completion: c.evacuated / this.agents.length,
      evacuated: c.evacuated,
      trapped: c.trapped,
      total: this.agents.length,
      peakDensity: Math.round(this.peakDensity * 100) / 100,
      maxCongestionPoints: this.maxCongestion,
      exitUsage: usage,
      alarmAt: this.alarmAt,
      endT: this.t,
    };
  }
}

export function runSimulation(cfg: SimConfig, layout?: Layout): SimSummary {
  return new Simulation(cfg, layout).runToEnd();
}

class MinHeap {
  private k = new Int32Array(1024);
  private v = new Float64Array(1024);
  size = 0;
  push(key: number, val: number) {
    if (this.size === this.k.length) {
      const k2 = new Int32Array(this.size * 2); k2.set(this.k); this.k = k2;
      const v2 = new Float64Array(this.size * 2); v2.set(this.v); this.v = v2;
    }
    const k = this.k, v = this.v;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= val) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k, v = this.v;
    const rk = k[0], rv = v[0];
    const n = --this.size;
    if (n > 0) {
      const lk = k[n], lv = v[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const m = l + 1 < n && v[l + 1] < v[l] ? l + 1 : l;
        if (v[m] >= lv) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return [rk, rv];
  }
}
