import React, { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_MOVE, AGENT_OUT, AGENT_TRAPPED, AGENT_WAIT, HAZARD_LABELS, SimConfig, Simulation, hazardStateAt, openExitIds } from "../sim/engine";
import { Layout, center, inRect } from "../sim/layout";
import type { AgentView, RouteLine } from "./useSimulation";

export type MapLayer = "all" | "people" | "routes" | "hazards";

type Props = {
  layout: Layout;
  cfg: SimConfig;
  t: number;
  getAgents?: () => AgentView | null;
  sim?: Simulation | null;
  routes?: RouteLine[];
  layer?: MapLayer;
  heat?: boolean;
  picking?: boolean;
  onPick?(zoneId: string, p: { x: number; y: number }): void;
  compact?: boolean;
  caption?: string;
  ariaLabel?: string;
};

const HZ_ICON: Record<string, string> = { fire: "🔥", gas: "☁", electrical: "⚡", crowd: "👥", operational: "⚠", closure: "⛔" };

function Plane({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} fill="#c5d5e8" opacity="0.9">
      <path d="M0 -14 L3 -4 L16 3 L16 6 L3 2 L2 10 L6 13 L6 15 L0 13 L-6 15 L-6 13 L-2 10 L-3 2 L-16 6 L-16 3 L-3 -4 Z" />
    </g>
  );
}

function StaticPlan({ layout, compact }: { layout: Layout; compact?: boolean }) {
  const o = layout.outer;
  return (
    <g>
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#14304b" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width={layout.width} height={layout.height} fill="#0d1d33" />
      <rect width={layout.width} height={layout.height} fill="url(#grid)" opacity="0.6" />
      {/* jet bridges + aircraft */}
      {layout.gates.map((g, i) => (
        <g key={g.id}>
          <rect x={g.x - 12} y={o.y - 34} width={24} height={36} fill="#1d3c5c" stroke="#3c6a8f" />
          <Plane x={g.x - 46} y={o.y - 24} />
          {!compact && <text x={g.x} y={o.y - 40} fontSize="9" fill="#94adc8" textAnchor="middle">G{i + 1}</text>}
        </g>
      ))}
      <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="#122841" stroke="#9fb9d6" strokeWidth="2.5" rx="2" />
      {layout.zones.map((z) => {
        const r = z.rect;
        return (
          <g key={z.id}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={z.kind === "concourse" ? "#1a3654" : "#15304c"} stroke="#9fb9d6" strokeOpacity={z.kind === "concourse" ? 0 : 0.85} strokeWidth="1.5" />
            {z.kind === "gate" && !compact && (
              <g fill="#3b5d80">
                {[0, 1].map((row) => Array.from({ length: 7 }).map((_, c) => (
                  <rect key={row + "-" + c} x={r.x + 24 + c * 22} y={r.y + 58 + row * 22} width="14" height="7" rx="1.5" />
                )))}
              </g>
            )}
            {z.kind === "service" && !compact && (
              z.id === "BAG" ? <rect x={r.x + 22} y={r.y + 70} width={r.w - 44} height={46} rx={23} fill="none" stroke="#9fb9d6" strokeWidth="5" opacity="0.5" />
              : z.id === "CHK" ? <g fill="#2a4a6c"><rect x={r.x + 30} y={r.y + 110} width={r.w - 60} height={60} /><rect x={r.x + 46} y={r.y + 84} width={6} height={30} /><rect x={r.x + r.w - 52} y={r.y + 84} width={6} height={30} /></g>
              : <g fill="#3b5d80">{[0, 1, 2].map((k) => <rect key={k} x={r.x + 20} y={r.y + 70 + k * 24} width={r.w - 40} height={8} rx="2" />)}</g>
            )}
            {z.door && <rect x={z.door.x} y={z.door.y + 3} width={z.door.w} height={z.door.h - 6} fill="#1a3654" />}
            {!compact && (
              <text x={z.kind === "concourse" ? r.x + r.w / 2 : r.x + r.w - 10} y={z.kind === "concourse" ? r.y + 52 : r.y + 22} fontSize={z.kind === "gate" ? 14 : 12} fontWeight="700" fill={z.kind === "concourse" ? "#94adc8" : "#f8faff"} textAnchor={z.kind === "concourse" ? "middle" : "end"}>
                {z.name}
              </text>
            )}
            {!compact && z.sub && <text x={r.x + r.w - 10} y={r.y + 40} fontSize="10" fill="#94adc8" textAnchor="end">{z.sub}</text>}
          </g>
        );
      })}
      {layout.mainEntrance.w > 0 && <rect x={layout.mainEntrance.x} y={layout.mainEntrance.y} width={layout.mainEntrance.w} height={layout.mainEntrance.h} fill="#1a3654" stroke="#9fb9d6" strokeWidth="1" />}
      {!compact && layout.mainEntrance.w > 0 && <text x={layout.mainEntrance.x + layout.mainEntrance.w / 2} y={layout.mainEntrance.y + layout.mainEntrance.h + 16} fontSize="11" fill="#c5d5e8" textAnchor="middle">الدخول الرئيسي</text>}
      {!compact && (
        <>
          <text x={layout.width - 30} y={36} fontSize="11" fill="#c5d5e8" textAnchor="end">{layout.name} / {layout.building}</text>
          <text x={30} y={36} fontSize="11" fill="#c5d5e8">N ↑</text>
          <g transform={`translate(30 ${layout.height - 22})`} fill="#94adc8" fontSize="9">
            <rect x="0" y="0" width="200" height="3" fill="#94adc8" opacity="0.6" />
            <text x="0" y="14">0</text><text x="200" y="14" textAnchor="middle">20 m</text>
          </g>
          <text x={layout.width - 30} y={layout.height - 12} fontSize="10" fill="#94adc8" textAnchor="end">مخطط خيالي • ليس للاستخدام الميداني</text>
        </>
      )}
    </g>
  );
}

export function AirportMap({ layout, cfg, t, getAgents, sim, routes = [], layer = "all", heat, picking, onPick, compact, caption, ariaLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const hz = hazardStateAt(cfg, t, layout);
  const hzPending = cfg.hazard && !hz?.active;
  const open = useMemo(() => new Set(openExitIds(cfg, layout)), [JSON.stringify(cfg), layout]);
  const showPeople = layer === "all" || layer === "people";
  const showRoutes = layer === "all" || layer === "routes";
  const showHaz = layer === "all" || layer === "hazards";
  const propsRef = useRef({ getAgents, sim, heat, showPeople, hz, layout });
  propsRef.current = { getAgents, sim, heat, showPeople, hz, layout };

  // canvas crowd layer
  useEffect(() => {
    const cv = canvas.current, box = wrap.current;
    if (!cv || !box) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = box.clientWidth * dpr;
      cv.height = box.clientHeight * dpr;
    });
    ro.observe(box);
    const draw = () => {
      const { getAgents, sim, heat, showPeople, hz, layout } = propsRef.current;
      const ctx = cv.getContext("2d");
      if (ctx && cv.width) {
        const sx = cv.width / layout.width, sy = cv.height / layout.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.setTransform(sx, 0, 0, sy, 0, 0);
        if (heat && sim) {
          for (let i = 0; i < sim.density.length; i++) {
            const d = sim.density[i];
            if (d < 0.3) continue;
            const k = Math.min(1, d / 4);
            ctx.fillStyle = `rgba(${255}, ${Math.round(212 - 180 * k)}, ${Math.round(119 - 70 * k)}, ${0.18 + 0.5 * k})`;
            ctx.fillRect((i % sim.cols) * 10, Math.floor(i / sim.cols) * 10, 10, 10);
          }
        }
        const ag = showPeople && getAgents ? getAgents() : null;
        if (ag) {
          const r = compact ? 3.2 : 2.6;
          for (let i = 0; i < ag.n; i++) {
            const st = ag.state[i];
            if (st === AGENT_OUT) continue;
            const x = ag.pos[i * 2], y = ag.pos[i * 2 + 1];
            let col = st === AGENT_WAIT ? "rgba(197,213,232,0.75)" : i >= ag.staffFrom ? "#ff9c60" : "#e9fff6";
            if (st === AGENT_TRAPPED) col = "#ed2346";
            else if (hz?.active && hz.radius > 0 && Math.hypot(x - hz.x, y - hz.y) < hz.radius) col = "#ff6d86";
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(x, y, st === AGENT_MOVE ? r : r * 0.85, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [compact]);

  const toMap = (e: React.MouseEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const zoneAt = (p: { x: number; y: number }) => layout.zones.find((z) => inRect(z.rect, p.x, p.y));

  // congestion markers: centroids of dense clusters
  const congestion = useMemo(() => {
    if (!sim || compact) return [];
    const cells = sim.congestionCells;
    const pts: { x: number; y: number; n: number }[] = [];
    for (const c of cells) {
      const x = (c % sim.cols) * 10 + 5, y = Math.floor(c / sim.cols) * 10 + 5;
      const near = pts.find((p) => Math.hypot(p.x - x, p.y - y) < 45);
      if (near) { near.x = (near.x * near.n + x) / (near.n + 1); near.y = (near.y * near.n + y) / (near.n + 1); near.n++; }
      else pts.push({ x, y, n: 1 });
    }
    return pts.filter((p) => p.n >= 3).slice(0, 6);
  }, [sim, Math.floor(t / 2), compact]);

  return (
    <div ref={wrap} className={`mapbox ${picking ? "picking" : ""}`} style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
      <svg ref={svgRef} viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ direction: "ltr" }} role="img" aria-label={ariaLabel ?? `مخطط ${layout.name}`}
        onClick={(e) => { if (!picking || !onPick) return; const p = toMap(e); const z = zoneAt(p); if (z) onPick(z.id, { x: Math.round(p.x), y: Math.round(p.y) }); }}
        onMouseMove={(e) => {
          if (compact) return;
          const p = toMap(e); const z = zoneAt(p);
          if (!z) return setHover(null);
          let n = 0;
          const ag = getAgents?.();
          if (ag) for (let i = 0; i < ag.n; i++) if (ag.state[i] <= AGENT_MOVE && inRect(z.rect, ag.pos[i * 2], ag.pos[i * 2 + 1])) n++;
          const r = svgRef.current!.getBoundingClientRect();
          setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: `${z.name} · ${picking ? "انقر لتحديد موقع الخطر" : `${n} شخص`}` });
        }}
        onMouseLeave={() => setHover(null)}>
        <StaticPlan layout={layout} compact={compact} />
        {/* exits */}
        {layout.exits.map((e) => {
          const isOpen = open.has(e.id) && hz?.closedExit !== e.id;
          const c = center(e.rect);
          return (
            <g key={e.id}>
              <rect x={e.rect.x} y={e.rect.y} width={e.rect.w} height={e.rect.h} rx="3" fill={isOpen ? "#56e4b5" : "#ed2346"} className={isOpen ? "" : "pulse"} />
              {!compact && (
                <text x={e.side === "left" ? c.x - 18 : e.side === "right" ? c.x + 18 : c.x} y={e.side === "bottom" ? e.rect.y + e.rect.h + 14 : c.y + 4} fontSize="11" fontWeight="700" fill={isOpen ? "#c5d5e8" : "#ff6d86"} textAnchor="middle">
                  {e.id}{!isOpen && " ×"}
                </text>
              )}
            </g>
          );
        })}
        {/* routes */}
        {showRoutes && routes.map((r, i) => (
          <polyline key={i} points={r.pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#56e4b5" strokeWidth={compact ? 3 : 2.4 + Math.min(2.5, r.load / 25)} strokeOpacity={0.85} className="route" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* hazard */}
        {showHaz && hz?.active && (
          <g>
            {hz.halo > 0 && (
              <circle cx={hz.x} cy={hz.y} r={hz.halo} fill={hz.type === "crowd" ? "rgba(255,212,119,0.10)" : "rgba(237,35,70,0.12)"} stroke={hz.type === "crowd" ? "#ffd477" : "#ed2346"} strokeDasharray="6 6" strokeOpacity="0.7" className="pulse" />
            )}
            {hz.radius > 0 && (
              <>
                <radialGradient id="hzg"><stop offset="0%" stopColor="#ed2346" stopOpacity="0.85" /><stop offset="100%" stopColor="#ed2346" stopOpacity="0.12" /></radialGradient>
                <circle cx={hz.x} cy={hz.y} r={hz.radius} fill="url(#hzg)" />
                <circle cx={hz.x} cy={hz.y} r={hz.radius} fill="none" stroke="#ff6d86" strokeWidth="2" style={{ transformOrigin: `${hz.x}px ${hz.y}px`, animation: "ring 1.8s ease-out infinite" }} />
              </>
            )}
            {hz.closedRect && <rect x={hz.closedRect.x - 2} y={hz.closedRect.y - 2} width={hz.closedRect.w + 4} height={hz.closedRect.h + 4} fill="#ed2346" className="pulse" />}
            <g transform={`translate(${hz.x - 16} ${hz.y - 16})`}>
              <rect width="32" height="32" rx="8" fill="#2b1323" stroke="#ed2346" />
              <text x="16" y="22" fontSize="16" textAnchor="middle">{HZ_ICON[hz.type]}</text>
            </g>
            {!compact && <text x={hz.x} y={hz.y + 34} fontSize="11" fontWeight="700" fill="#ff9c60" textAnchor="middle">{HAZARD_LABELS[hz.type]}{hz.closedExit ? ` · إغلاق ${hz.closedExit}` : ""}</text>}
          </g>
        )}
        {showHaz && hzPending && cfg.hazard && (() => {
          const z = layout.zones.find((zz) => zz.id === cfg.hazard!.zoneId);
          const p = cfg.hazard!.point ?? (z ? center(z.rect) : null);
          return p ? <g opacity="0.8"><circle cx={p.x} cy={p.y} r="14" fill="none" stroke="#ff9c60" strokeDasharray="4 4" /><circle cx={p.x} cy={p.y} r="3" fill="#ff9c60" />{!compact && <text x={p.x} y={p.y - 20} fontSize="10" fill="#ff9c60" textAnchor="middle">موقع الخطر المجدول</text>}</g> : null;
        })()}
        {showHaz && congestion.map((c, i) => (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r={18 + Math.min(20, c.n)} fill="rgba(255,212,119,0.12)" stroke="#ffd477" strokeDasharray="4 4" className="pulse" />
            {!compact && i < 2 && <text x={c.x} y={c.y + 38 + Math.min(20, c.n) - 18} fontSize="10" fontWeight="700" fill="#ffd477" textAnchor="middle">! كثافة مرتفعة</text>}
          </g>
        ))}
      </svg>
      <canvas ref={canvas} aria-hidden />
      {hover && <div className="map-tip" style={{ left: hover.x, top: hover.y }}>{hover.text}</div>}
      {caption && <div className="tiny muted" style={{ position: "absolute", bottom: 6, left: 10 }}>{caption}</div>}
    </div>
  );
}

export function MapLegend() {
  return (
    <div className="legend" aria-label="مفتاح الخريطة">
      <span className="g">✓ مسار / مخرج متاح</span>
      <span className="y">◉ ازدحام</span>
      <span className="o">! منطقة متأثرة</span>
      <span className="r">× مغلق</span>
      <span style={{ color: "var(--secondary)" }}>● مسافر · <span style={{ color: "var(--orange)" }}>●</span> موظف</span>
    </div>
  );
}
