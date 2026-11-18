export type SendResult = { status: "success" | "warning" | "error"; message: string; retryAt?: number };

export function canSendPreparedOrder(order: { status: string; omie_order_id: number | null }) {
  return order.status === "ready" && !order.omie_order_id;
}

/** Never authorizes a new inclusion retry. Pending/uncertain orders need reconciliation. */
export async function runOrderSendBatch(ids: string[], options: {
  send: (id: string, confirmRetry: false) => Promise<SendResult>;
  onStart: (id: string) => void;
  onResult: (id: string, result: SendResult) => void;
  shouldStop: () => boolean;
  onWait?: (retryAt: number) => void;
  now?: () => number;
  wait?: (ms: number) => Promise<unknown>;
}) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100) throw new Error("Selecione de 1 a 100 pedidos preparados.");
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let retryAt = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < unique.length) {
      if (retryAt > now()) options.onWait?.(retryAt);
      while (retryAt > now() && !options.shouldStop()) await wait(Math.min(1000, retryAt - now()));
      if (options.shouldStop() || cursor >= unique.length) return;
      const id = unique[cursor++];
      options.onStart(id);
      let result: SendResult;
      try { result = await options.send(id, false); }
      catch { result = { status: "warning", message: "Resposta não confirmada. Use Atualizar Omie para conferir este pedido antes de qualquer nova tentativa." }; }
      if (typeof result.retryAt === "number" && Number.isFinite(result.retryAt)) retryAt = Math.max(retryAt, result.retryAt);
      options.onResult(id, result);
    }
  };
  // At most two distinct orders in progress; each one is attempted once.
  // The API controller still serializes outbound calls and keeps per-ID windows.
  await Promise.all([worker(), worker()]);
}
