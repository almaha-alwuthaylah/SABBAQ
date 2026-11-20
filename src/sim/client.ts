import { useCallback, useEffect, useRef, useState } from "react";
import * as A from "./analysis";
import type { SimConfig } from "./engine";
import type { Layout } from "./layout";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { res(v: any): void; rej(e: any): void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker("./worker.js");
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      e.data.ok ? p.res(e.data.result) : p.rej(new Error(e.data.error));
    };
    worker.onerror = () => { worker = null; };
  } catch { worker = null; }
  return worker;
}

/** Runs an analysis in a Web Worker; falls back to the main thread if workers are unavailable. */
export function runAnalysis<T>(kind: "scored" | "improvements" | "stress" | "robustness" | "ai", ...args: any[]): Promise<T> {
  const w = getWorker();
  if (!w) {
    return new Promise((res, rej) => setTimeout(() => {
      try {
        const [cfg, layout] = args as [SimConfig, Layout];
        const r = kind === "scored" ? A.scored(cfg, layout) : kind === "improvements" ? A.evaluateImprovements(cfg, layout)
          : kind === "stress" ? A.stressTest(cfg, layout) : kind === "robustness" ? A.robustness(cfg, args[2] ?? 12, layout) : A.aiProposal(cfg, 2, layout);
        res(r as T);
      } catch (e) { rej(e); }
    }, 30));
  }
  const id = ++seq;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); w.postMessage({ id, kind, args }); });
}

/** Hook wrapper with loading/error state and elapsed-time progress estimate. */
export function useAnalysis<T>() {
  const [state, setState] = useState<{ status: "idle" | "running" | "done" | "error"; data?: T; error?: string; started?: number }>({ status: "idle" });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async (kind: Parameters<typeof runAnalysis>[0], ...args: any[]) => {
    setState({ status: "running", started: Date.now() });
    try {
      const data = await runAnalysis<T>(kind, ...args);
      if (alive.current) setState({ status: "done", data });
      return data;
    } catch (e) {
      if (alive.current) setState({ status: "error", error: (e as Error).message });
      return undefined;
    }
  }, []);
  return { ...state, run, reset: () => setState({ status: "idle" }) };
}
