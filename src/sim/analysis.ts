// Higher-level analyses built purely on the engine. All outputs are illustrative.
import { HazardType, Modifiers, SimConfig, SimSummary, runSimulation, HAZARD_LABELS } from "./engine";
import { DEFAULT_LAYOUT, Layout } from "./layout";

export type Scored = { summary: SimSummary; score: number };

/** Illustrative safety index 0–100 (higher is safer). Weights are documented, not validated. */
export function safetyScore(s: SimSummary): number {
  const t = s.evacTime ?? 900;
  const trappedPct = s.trapped / Math.max(1, s.total);
  const v = 100 - t / 6 - trappedPct * 250 - Math.max(0, s.peakDensity - 2) * 4 - s.maxCongestionPoints * 1.5 - (1 - s.completion) * 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export const scored = (cfg: SimConfig, layout?: Layout): Scored => {
  const summary = runSimulation(cfg, layout);
  return { summary, score: safetyScore(summary) };
};

export type Verdict = "better" | "neutral" | "worse";
export function verdict(before: Scored, after: Scored): Verdict {
  const bt = before.summary.evacTime ?? 900, at = after.summary.evacTime ?? 900;
  const dTrapped = after.summary.trapped - before.summary.trapped;
  if (dTrapped < 0) return "better";
  if (dTrapped > 0) return "worse";
  const rel = (at - bt) / bt;
  if (Math.abs(rel) < 0.03 && Math.abs(after.score - before.score) < 2) return "neutral";
  return rel < 0 || after.score > before.score ? "better" : "worse";
}

export type Candidate = { id: string; title: string; detail: string; requirement: string; modifiers: Modifiers };

export const IMPROVEMENTS: Candidate[] = [
  { id: "alt-route", title: "فتح مسار إخلاء بديل", detail: "تشغيل مخارج الطوارئ E03 و E04 وتوجيه الحركة نحوها", requirement: "يتطلب مراجعة هندسية", modifiers: { openExits: ["E3", "E4"] } },
  { id: "redistribute", title: "إعادة توزيع المسافرين", detail: "توجيه الموظفين للحركة نحو المخارج الأقل ازدحامًا", requirement: "قابل للاختبار", modifiers: { guidance: true } },
  { id: "east-widen", title: "توسعة الممر الشرقي", detail: "مضاعفة عرض أبواب البوابتين 03 و 04 واستلام الأمتعة والتشغيل", requirement: "أثر تقديري · يتطلب تعديلًا إنشائيًا", modifiers: { widenDoors: ["G03", "G04", "BAG", "OPS"] } },
  { id: "gate-doors", title: "توسعة أبواب صالات الانتظار", detail: "مضاعفة عرض أبواب البوابات الأربع نحو البهو", requirement: "أثر تقديري · يتطلب تعديلًا إنشائيًا", modifiers: { widenDoors: ["G01", "G02", "G03", "G04"] } },
  { id: "marshals", title: "زيادة فريق التوجيه", detail: "إضافة 15 موظف توجيه لتسريع بدء الإخلاء", requirement: "قابل للتطبيق تشغيليًا", modifiers: { extraMarshals: 15 } },
];

export function mergeMods(base: Modifiers | undefined, add: Modifiers): Modifiers {
  const b = base ?? {};
  const u = (x?: string[], y?: string[]) => (x || y ? Array.from(new Set([...(x ?? []), ...(y ?? [])])) : undefined);
  return {
    widenDoors: u(b.widenDoors, add.widenDoors),
    openExits: u(b.openExits, add.openExits),
    closeExits: u(b.closeExits, add.closeExits),
    guidance: b.guidance || add.guidance || undefined,
    extraMarshals: (b.extraMarshals ?? 0) + (add.extraMarshals ?? 0) || undefined,
  };
}

export type EvaluatedCandidate = Candidate & Scored & { verdict: Verdict; deltaTime: number };

export function applicable(layout: Layout = DEFAULT_LAYOUT) {
  const zs = new Set(layout.zones.map((z) => z.id)), es = new Set(layout.exits.map((e) => e.id));
  return IMPROVEMENTS.filter((c) => (c.modifiers.widenDoors ?? []).every((z) => zs.has(z)) && (c.modifiers.openExits ?? []).every((e) => es.has(e)));
}

export function evaluateImprovements(cfg: SimConfig, layout: Layout = DEFAULT_LAYOUT, list: Candidate[] = applicable(layout)) {
  const baseline = scored(cfg, layout);
  const candidates: EvaluatedCandidate[] = list
    .map((c) => {
      const r = scored({ ...cfg, modifiers: mergeMods(cfg.modifiers, c.modifiers) }, layout);
      return { ...c, ...r, verdict: verdict(baseline, r), deltaTime: (r.summary.evacTime ?? 900) - (baseline.summary.evacTime ?? 900) };
    })
    .sort((a, b) => b.score - a.score || a.deltaTime - b.deltaTime);
  return { baseline, candidates };
}

export type StressCase = { id: string; title: string; cfg: SimConfig } & Scored;

export function stressTest(cfg: SimConfig, layout: Layout = DEFAULT_LAYOUT) {
  const baseline = scored(cfg, layout);
  const at = cfg.hazard?.at ?? 20;
  const cases: { id: string; title: string; cfg: SimConfig }[] = [];
  const zones = layout.zones.map((z) => z.id);
  const types: HazardType[] = ["fire", "gas", "closure", "operational"];
  for (const type of types)
    for (const zoneId of zones) {
      const zn = layout.zones.find((z) => z.id === zoneId)!.name;
      cases.push({ id: `${type}-${zoneId}`, title: `${HAZARD_LABELS[type]} · ${zn}`, cfg: { ...cfg, hazard: { type, zoneId, at } } });
    }
  for (const e of layout.exits)
    cases.push({ id: `exit-${e.id}`, title: `إغلاق ${e.name} منذ البداية`, cfg: { ...cfg, modifiers: mergeMods(cfg.modifiers, { closeExits: [e.id] }) } });
  cases.push({ id: "surge", title: "زيادة الحشود 40٪", cfg: { ...cfg, passengers: Math.round(cfg.passengers * 1.4) } });
  cases.push({ id: "slow", title: "انخفاض سرعة الحركة 30٪", cfg: { ...cfg, speed: +(cfg.speed * 0.7).toFixed(2) } });
  const results: StressCase[] = cases.map((c) => ({ ...c, ...scored(c.cfg, layout) })).sort((a, b) => a.score - b.score);
  return { baseline, results, worst: results[0], breaking: results.filter((r) => r.summary.trapped > 0 || r.score < baseline.score - 15) };
}

export function robustness(cfg: SimConfig, n = 12, layout: Layout = DEFAULT_LAYOUT) {
  const runs: { seed: number; passengers: number; speed: number; score: number; evacTime: number; trapped: number }[] = [];
  for (let i = 0; i < n; i++) {
    const k = (i / Math.max(1, n - 1)) * 2 - 1; // −1..1 sweep, deterministic
    const c: SimConfig = {
      ...cfg,
      seed: cfg.seed + 101 * (i + 1),
      passengers: Math.max(10, Math.round(cfg.passengers * (1 + 0.2 * k))),
      speed: +(cfg.speed * (1 - 0.15 * Math.sin(i * 1.7))).toFixed(2),
    };
    const r = scored(c, layout);
    runs.push({ seed: c.seed, passengers: c.passengers, speed: c.speed, score: r.score, evacTime: r.summary.evacTime ?? 900, trapped: r.summary.trapped });
  }
  const times = runs.map((r) => r.evacTime);
  const scores = runs.map((r) => r.score);
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { runs, min: Math.min(...times), max: Math.max(...times), meanScore: Math.round(mean), sdScore: +sd.toFixed(1), stable: sd < 6 && runs.every((r) => r.trapped === 0) };
}

/** "AI" competitor: exhaustive search over pairs of candidate measures (transparent, not ML). */
export function aiProposal(cfg: SimConfig, maxMeasures = 2, layout: Layout = DEFAULT_LAYOUT) {
  let best: { ids: string[]; mods: Modifiers; result: Scored } | null = null;
  const C = applicable(layout);
  const combos: string[][] = [];
  for (let i = 0; i < C.length; i++) {
    combos.push([C[i].id]);
    if (maxMeasures > 1) for (let j = i + 1; j < C.length; j++) combos.push([C[i].id, C[j].id]);
  }
  for (const ids of combos) {
    let mods = cfg.modifiers ?? {};
    for (const id of ids) mods = mergeMods(mods, C.find((c) => c.id === id)!.modifiers);
    const result = scored({ ...cfg, modifiers: mods }, layout);
    if (!best || result.score > best.result.score || (result.score === best.result.score && (result.summary.evacTime ?? 900) < (best.result.summary.evacTime ?? 900)))
      best = { ids, mods, result };
  }
  return { ...best!, tried: combos.length };
}

export function describeModifiers(m?: Modifiers): string[] {
  if (!m) return [];
  const out: string[] = [];
  if (m.openExits?.length) out.push(`تشغيل ${m.openExits.join("، ")}`);
  if (m.closeExits?.length) out.push(`إغلاق ${m.closeExits.join("، ")}`);
  if (m.widenDoors?.length) out.push(`توسعة أبواب ${m.widenDoors.map((z) => DEFAULT_LAYOUT.zones.find((x) => x.id === z)?.name ?? z).join("، ")}`);
  if (m.guidance) out.push("توجيه نشط لإعادة توزيع الحركة");
  if (m.extraMarshals) out.push(`إضافة ${m.extraMarshals} موظف توجيه`);
  return out;
}
