// Runs heavy analyses off the main thread.
import { aiProposal, evaluateImprovements, robustness, scored, stressTest } from "./analysis";

type Msg = { id: number; kind: string; args: any[] };
self.onmessage = (e: MessageEvent<Msg>) => {
  const { id, kind, args } = e.data;
  try {
    let result: unknown;
    switch (kind) {
      case "scored": result = scored(args[0], args[1]); break;
      case "improvements": result = evaluateImprovements(args[0], args[1]); break;
      case "stress": result = stressTest(args[0], args[1]); break;
      case "robustness": result = robustness(args[0], args[2] ?? 12, args[1]); break;
      case "ai": result = aiProposal(args[0], 2, args[1]); break;
      default: throw new Error("unknown analysis " + kind);
    }
    (self as any).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as any).postMessage({ id, ok: false, error: String((err as Error).message ?? err) });
  }
};
