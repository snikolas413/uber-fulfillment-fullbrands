import type { BillingOutcome } from "./invoice-order";

type Result = { status: "success" | "warning" | "error"; message: string; billingOutcome?: BillingOutcome };

export async function runBillingBatch(ids: string[], {
  invoice, onStart, onResult, shouldStop = () => false,
}: {
  invoice: (id: string) => Promise<Result>; onStart: (id: string) => void;
  onResult: (id: string, result: Result) => void; shouldStop?: () => boolean;
}) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100) throw new Error("Selecione de 1 a 100 pedidos por lote.");
  const processed: string[] = [];
  for (const id of unique) {
    if (shouldStop()) break;
    onStart(id);
    let result: Result;
    try { result = await invoice(id); }
    catch { result = { status: "warning", billingOutcome: "unknown", message: "A resposta desta tentativa não chegou. Use Atualizar Omie antes de tentar emitir novamente." }; }
    processed.push(id);
    onResult(id, result);
  }
  return processed;
}
