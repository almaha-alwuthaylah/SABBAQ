# SABBAQ · سَبّاق

**An interactive digital-twin showcase for simulating airport emergencies.** Trigger a fire, gas leak or exit closure in a passenger terminal, watch hundreds of people evacuate in real time, then stress-test the plan, evaluate improvements and compare solutions side by side.

> Frontend-only portfolio project · Arabic RTL · Responsive · No backend.
> The facility, data and results are **illustrative**: a fictional airport and a simplified crowd model, not a validated engineering tool.

---

## Highlights

- **Live airport map.** An SVG floor plan with a Canvas crowd layer that animates 800+ people at 60 fps. It shows spreading hazard zones, congestion hot-spots, closed exits and animated evacuation routes that re-plan as conditions change.
- **A real simulation engine (client-side).** Deterministic agent-based evacuation, so the same inputs always give the same results:
  - a 1 m grid with Dijkstra distance fields toward open exits, re-planned every 2 s with hazard and crowd-avoidance costs
  - density-dependent walking speed (Weidmann's fundamental diagram) and a physical cap of 5 people per m²
  - exit flow capacity based on door width
  - pre-movement delays shortened by staff guidance
- **Replay and time travel.** Recorded frames let you scrub the timeline and jump back to the moment a hazard started.
- **Analysis modules.** Heavy runs execute in a Web Worker so the UI stays smooth.
  - *Break my plan:* 46 automatic stress scenarios, ranked from worst to best
  - *Save the plan:* each improvement is tested with a full simulation and labelled better, no material difference, or worse
  - *Before / After* and *Solutions duel:* two synchronised simulations side by side
  - *Human vs AI:* you pick up to two measures; a transparent exhaustive search picks its own best combination
  - *Robustness:* 12 runs with varied crowd size and walking speed
  - *Risk lens:* layer toggles (people, routes, hazards), a density heat-map and key-moment bookmarks
- **Dashboards and reports.** Analytics charts, run history, and safety-decision files. Sample data is produced by the real engine at build time (`scripts/seed.ts`), not typed in by hand.
- **Design system.** Tokens taken from the Figma variables (midnight-blue surfaces, red/orange/yellow/green status colours, Tajawal type scale). Every UI state is covered: loading, empty, error, success and disabled. Status never relies on colour alone.

## Tech stack

| Area | Choice | Why |
|---|---|---|
| UI | React 19 + TypeScript | Component model; strict typing for the simulation domain |
| Build | Bun (bundler, test runner, dev server) | Fast, zero-config, one tool |
| Map rendering | SVG (geometry and overlays) + Canvas 2D (crowd) | Crisp, accessible plan; cheap animation for hundreds of agents |
| Simulation | Pure TypeScript module (`src/sim`) | UI-independent, deterministic, unit-tested |
| Concurrency | Web Worker | Stress, improvement and robustness runs don't block the UI |
| State and data | React context + a `localStorage` mock data layer | No server; the demo account and projects persist in the browser |
| Routing | Hash routes (`#lab`, `#project-p1`) | Works on any static host |

No CSS framework and no chart library are used: the styles and charts are hand-built to match the design.

## Getting started

```bash
bun install
bun run start      # builds to dist/ and serves at http://localhost:4173
bun test           # engine and analysis tests
bun run seed       # regenerate the sample results from the engine
```

Deploy by uploading `dist/` to any static host (GitHub Pages, Netlify, Vercel).

Sign-in is a **demo flow**: any email and an 8-character password work, and nothing leaves the browser. Visitors can also use **Try as guest**.

## Project structure

```
src/
  sim/        engine.ts (crowd model) · analysis.ts (scores, stress, improvements, AI search)
              layout.ts (fictional terminal) · worker.ts / client.ts (Web Worker bridge) · *.test.ts
  map/        AirportMap.tsx (SVG + Canvas renderer) · useSimulation.ts (playback, replay, routes)
  screens/    Auth · Projects/Dashboard · Lab · Modules (analysis tools, analytics, reports, profile) · Studio
  ui/         kit.tsx (design-system components)
  data/       api.ts (mock data layer) · seed.json (engine-generated samples)
  styles/     app.css (tokens + components + responsive rules)
```

## Design notes

- The Figma file is the visual source of truth. Its foundation swatch labels (`#0D1422`…) differ from the variables bound in the screens (`#070e20`…). The screens' variables are used, and the discrepancy is documented in `app.css`.
- The safety index (0–100) is a transparent weighted formula in `analysis.ts`. It is meant for comparing scenarios, not for certification.

## Limitations

- Automatic tracing of uploaded floor plans is not included. The Studio supports upload, scale calibration, and geometry, exit and connectivity checks on the project layout.
- The crowd model is deliberately simplified (no counter-flow, stairs or smoke toxicity modelling).

---

*SABBAQ (سَبّاق) — "we simulate risks to get ahead of them."*
