export type BatchLabelResult = { status: "success" | "error"; message: string; url?: string };
export function canPrepareShippingLabel(state: string) { return ["none", "sources_ready", "ready"].includes(state); }

export async function runShippingLabelBatch(ids: string[], options: {
  generate: (id: string, confirmed: true) => Promise<BatchLabelResult>;
  onStart: (id: string) => void;
  onResult: (id: string, result: BatchLabelResult) => void;
  shouldStop: () => boolean;
}) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100) throw new Error("Selecione de 1 a 100 pedidos por lote.");
  const ready: string[] = [];
  for (const id of unique) {
    if (options.shouldStop()) break;
    options.onStart(id);
    let result: BatchLabelResult;
    try { result = await options.generate(id, true); }
    catch { result = { status: "error", message: "Resposta não confirmada. Confira a etiqueta deste pedido antes de tentar gerar novamente." }; }
    if (result.status === "success" && result.url) ready.push(id);
    options.onResult(id, result);
  }
  return ready;
}
