import type { BillingOutcome } from "./invoice-order";

type Result = { status: "success" | "warning" | "error"; message: string; billingOutcome?: BillingOutcome; retryAt?: number };

export async function runBillingBatch(ids: string[], {
  invoice, onStart, onResult, shouldStop = () => false, onWait,
  now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
}: {
  invoice: (id: string) => Promise<Result>; onStart: (id: string) => void;
  onResult: (id: string, result: Result) => void; shouldStop?: () => boolean;
  onWait?: (retryAt: number) => void; now?: () => number; wait?: (ms: number) => Promise<unknown>;
}) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100) throw new Error("Selecione de 1 a 100 pedidos por lote.");
  const processed: string[] = [];
  let retryAt = 0;
  for (const id of unique) {
    if (retryAt > now()) onWait?.(retryAt);
    while (retryAt > now() && !shouldStop()) await wait(Math.min(1000, retryAt - now()));
    if (shouldStop()) break;
    onStart(id);
    let result: Result;
    try { result = await invoice(id); }
    catch { result = { status: "warning", billingOutcome: "unknown", message: "A resposta desta tentativa não chegou. Use Atualizar Omie antes de tentar emitir novamente." }; }
    processed.push(id);
    onResult(id, result);
    retryAt = typeof result.retryAt === "number" && Number.isFinite(result.retryAt) ? result.retryAt : 0;
  }
  return processed;
}
