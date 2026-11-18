import type { BatchLabelResult } from "./shipping-label-batch";

/** Independent HTTP requests permit two pipelines without serial Server Actions. */
export async function prepareShippingLabel(id: string, confirmed: true): Promise<BatchLabelResult> {
  if (confirmed !== true) throw new Error("Confirme a preparação da etiqueta.");
  const response = await fetch("/api/expedicao/preparar", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, confirmed: true }),
  });
  const data = await response.json().catch(() => null) as Partial<BatchLabelResult> | null;
  if (!data || !["success", "error"].includes(data.status ?? "") || typeof data.message !== "string" ||
    (data.status === "success" && (!response.ok || typeof data.url !== "string" || data.url !== "/api/expedicao/" + id + "/etiqueta"))) {
    throw new Error("Resposta não confirmada. Confira a etiqueta antes de tentar gerar novamente.");
  }
  return { status: data.status as BatchLabelResult["status"], message: data.message,
    ...(typeof data.url === "string" ? { url: data.url } : {}),
    ...(typeof data.retryAt === "number" && Number.isFinite(data.retryAt) ? { retryAt: data.retryAt } : {}) };
}
