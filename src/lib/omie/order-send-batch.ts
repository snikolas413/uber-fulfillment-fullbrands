export type SendResult = { status: "success" | "warning" | "error"; message: string };

export function canSendPreparedOrder(order: { status: string; omie_order_id: number | null }) {
  return order.status === "ready" && !order.omie_order_id;
}

/** Never authorizes a new inclusion retry. Pending/uncertain orders need reconciliation. */
export async function runOrderSendBatch(ids: string[], options: {
  send: (id: string, confirmRetry: false) => Promise<SendResult>;
  onStart: (id: string) => void;
  onResult: (id: string, result: SendResult) => void;
  shouldStop: () => boolean;
}) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100) throw new Error("Selecione de 1 a 100 pedidos preparados.");
  for (const id of unique) {
    if (options.shouldStop()) break;
    options.onStart(id);
    let result: SendResult;
    try { result = await options.send(id, false); }
    catch { result = { status: "warning", message: "Resposta não confirmada. Use Atualizar Omie para conferir este pedido antes de qualquer nova tentativa." }; }
    options.onResult(id, result);
  }
}
