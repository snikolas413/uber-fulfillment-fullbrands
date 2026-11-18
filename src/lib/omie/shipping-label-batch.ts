export type BatchLabelResult = { status: "success" | "error"; message: string; url?: string; retryAt?: number };
export function canPrepareShippingLabel(state: string) { return ["none", "sources_ready", "ready"].includes(state); }

export async function runShippingLabelBatch(ids: string[], options: {
  generate: (id: string, confirmed: true) => Promise<BatchLabelResult>;
  onStart: (id: string) => void;
  onResult: (id: string, result: BatchLabelResult) => void;
  shouldStop: () => boolean;
  onWait?: (retryAt: number) => void;
  now?: () => number;
  wait?: (ms: number) => Promise<unknown>;
}) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100) throw new Error("Selecione de 1 a 100 pedidos por lote.");
  const ready: string[] = [];
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let retryAt = 0;
  for (const id of unique) {
    // An error belongs to the previous order. Wait for API protection to expire
    // before starting the NEXT order; never replay the failed generation.
    if (retryAt > now()) options.onWait?.(retryAt);
    while (retryAt > now() && !options.shouldStop()) await wait(Math.min(1000, retryAt - now()));
    if (options.shouldStop()) break;
    options.onStart(id);
    let result: BatchLabelResult;
    try { result = await options.generate(id, true); }
    catch { result = { status: "error", message: "Resposta não confirmada. Confira a etiqueta deste pedido antes de tentar gerar novamente." }; }
    if (result.status === "success" && result.url) ready.push(id);
    options.onResult(id, result);
    retryAt = result.status === "error" && typeof result.retryAt === "number" && Number.isFinite(result.retryAt) ? result.retryAt : 0;
  }
  return ready;
}
