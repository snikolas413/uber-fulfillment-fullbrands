import type { SendResult } from "./order-send-batch";

/** Independent HTTP requests avoid the client's serial Server Action queue. */
export async function sendPreparedOrder(id: string, confirmRetry: false): Promise<SendResult> {
  if (confirmRetry !== false) throw new Error("O lote não autoriza repetir inclusões.");
  const response = await fetch("/api/pedidos/enviar", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, confirmed: true }),
  });
  const data = await response.json().catch(() => null) as Partial<SendResult> | null;
  if (!data || !["success", "warning", "error"].includes(data.status ?? "") || typeof data.message !== "string") {
    throw new Error("Resposta do envio não confirmada. Confira o pedido antes de tentar novamente.");
  }
  if (!response.ok && data.status === "success") throw new Error("O servidor não confirmou o envio do pedido.");
  return { status: data.status as SendResult["status"], message: data.message,
    ...(typeof data.retryAt === "number" && Number.isFinite(data.retryAt) ? { retryAt: data.retryAt } : {}) };
}
