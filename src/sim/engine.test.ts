import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, Simulation, runSimulation, openExitIds, hazardStateAt } from "./engine";
import { evaluateImprovements, stressTest, robustness } from "./analysis";

const base = { ...DEFAULT_CONFIG, passengers: 300 };

describe("engine", () => {
  test("every walkable cell can reach an exit in the baseline", () => {
    const s = new Simulation(base);
    let unreachable = 0;
    for (let i = 0; i < s.walk.length; i++) if (s.walk[i] && s.field[i] >= 1e9) unreachable++;
    expect(unreachable).toBe(0);
  });

  test("baseline evacuates everyone", () => {
    const r = runSimulation(base);
    expect(r.completion).toBe(1);
    expect(r.trapped).toBe(0);
    expect(r.evacTime).toBeGreaterThan(0);
  });

  test("deterministic for the same seed", () => {
    expect(runSimulation(base)).toEqual(runSimulation(base));
  });

  test("density never exceeds the physical cap", () => {
    expect(runSimulation({ ...base, passengers: 900 }).peakDensity).toBeLessThanOrEqual(5);
  });

  test("exit counts select the right exits", () => {
    expect(openExitIds({ ...base, exits: 4, emergencyExits: 2 })).toEqual(["E1", "E2", "E3", "E4"]);
    expect(openExitIds({ ...base, exits: 3, emergencyExits: 2 })).toEqual(["E1", "E3", "E4"]);
    expect(openExitIds({ ...base, exits: 2, emergencyExits: 0 })).toEqual(["E1", "E2"]);
  });

  test("operational hazard closes the nearest exit and nobody uses it", () => {
    const cfg = { ...base, hazard: { type: "operational" as const, zoneId: "G04", at: 10 } };
    expect(hazardStateAt(cfg, 20)?.closedExit).toBe("E2");
    expect(runSimulation(cfg).exitUsage.E2).toBe(0);
  });

  test("closing a gate door strands the people inside", () => {
    const r = runSimulation({ ...base, hazard: { type: "closure", zoneId: "G03", at: 0 } });
    expect(r.trapped).toBeGreaterThan(0);
  });

  test("fewer exits do not evacuate faster", () => {
    const a = runSimulation({ ...base, passengers: 800 });
    const b = runSimulation({ ...base, passengers: 800, exits: 2, emergencyExits: 0 });
    expect(b.evacTime!).toBeGreaterThanOrEqual(a.evacTime!);
  });
});

describe("analysis", () => {
  test("improvement evaluation returns ranked, labelled candidates", () => {
    const cfg = { ...base, passengers: 700, hazard: { type: "operational" as const, zoneId: "G04", at: 20 } };
    const res = evaluateImprovements(cfg);
    expect(res.candidates.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < res.candidates.length; i++) expect(res.candidates[i - 1].score).toBeGreaterThanOrEqual(res.candidates[i].score);
    expect(["better", "neutral", "worse"]).toContain(res.candidates[0].verdict);
  });

  test("stress test finds a worst case no better than baseline", { timeout: 60000 }, () => {
    const r = stressTest({ ...base, passengers: 500 });
    expect(r.worst.score).toBeLessThanOrEqual(r.baseline.score);
  });

  test("robustness reports a spread", () => {
    const r = robustness({ ...base, passengers: 400 }, 6);
    expect(r.runs.length).toBe(6);
    expect(r.max).toBeGreaterThanOrEqual(r.min);
  });
});
