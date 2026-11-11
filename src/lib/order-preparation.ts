export type PreparationResult = { status: "idle" | "success" | "error"; message: string };

export function defaultDeliveryAddress<T extends { id: string; created_at: string; validation_status: string }>(addresses: T[]) {
  return [...addresses].filter(address => address.validation_status !== "invalid")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))[0];
}

/** Each recipient keeps the same key when a failed/uncertain request is retried. */
export async function runPreparationBatch(ids: string[], options: {
  prepare: (id: string) => Promise<PreparationResult>;
  onResult: (id: string, result: PreparationResult) => void;
}) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100) throw new Error("Selecione de 1 a 100 destinatários por lote.");
  for (const id of unique) {
    let result: PreparationResult;
    try { result = await options.prepare(id); }
    catch { result = { status: "error", message: "Resposta não confirmada. Tente novamente neste lote para conferir sem duplicar o pedido." }; }
    options.onResult(id, result);
  }
}
