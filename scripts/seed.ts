// Generates src/data/seed.json by running the real engine on sample scenarios (build-time, deterministic).
import { DEFAULT_CONFIG, SimConfig } from "../src/sim/engine";
import { scored, IMPROVEMENTS, mergeMods } from "../src/sim/analysis";

const base: SimConfig = { ...DEFAULT_CONFIG };
const fire: SimConfig = { ...base, hazard: { type: "fire", zoneId: "G03", at: 30 } };
const plans: { projectId: string; kind: string; title: string; cfg: SimConfig; daysAgo: number }[] = [
  { projectId: "p1", kind: "simulation", title: "حريق – بوابة 03", cfg: fire, daysAgo: 1 },
  { projectId: "p1", kind: "simulation", title: "خطر تشغيلي – إغلاق E2", cfg: { ...base, passengers: 700, hazard: { type: "operational", zoneId: "G04", at: 20 } }, daysAgo: 2 },
  { projectId: "p1", kind: "improvement", title: "إعادة توزيع المسافرين", cfg: { ...fire, modifiers: mergeMods(undefined, IMPROVEMENTS[1].modifiers) }, daysAgo: 1 },
  { projectId: "p1", kind: "improvement", title: "فتح مسار إخلاء بديل", cfg: { ...fire, exits: 2, emergencyExits: 0, modifiers: mergeMods(undefined, IMPROVEMENTS[0].modifiers) }, daysAgo: 3 },
  { projectId: "p1", kind: "stress", title: "أسوأ حالة: إغلاق ممر البوابة 02", cfg: { ...base, hazard: { type: "closure", zoneId: "G02", at: 20 } }, daysAgo: 4 },
  { projectId: "p2", kind: "simulation", title: "تسرّب غاز – البهو الرئيسي", cfg: { ...base, passengers: 600, hazard: { type: "gas", zoneId: "CON", at: 25 } }, daysAgo: 5 },
  { projectId: "p2", kind: "simulation", title: "تمرين إخلاء بدون خطر", cfg: { ...base, passengers: 400 }, daysAgo: 8 },
  { projectId: "p3", kind: "simulation", title: "ازدحام – تفتيش أمني", cfg: { ...base, passengers: 900, distribution: "concourse", hazard: { type: "crowd", zoneId: "SEC", at: 15 } }, daysAgo: 6 },
  { projectId: "p3", kind: "robustness", title: "اختبار تحمّل – 12 تشغيلًا", cfg: { ...base, passengers: 520 }, daysAgo: 9 },
];
const runs = plans.map((p, i) => {
  const r = scored(p.cfg);
  return { id: "r" + (i + 1), projectId: p.projectId, kind: p.kind, title: p.title, config: p.cfg, summary: r.summary, score: r.score, daysAgo: p.daysAgo };
});
await Bun.write("src/data/seed.json", JSON.stringify({ runs }, null, 1));
console.log(runs.map((r) => `${r.title}: ${r.summary.evacTime}s score ${r.score} trapped ${r.summary.trapped}`).join("\n"));
