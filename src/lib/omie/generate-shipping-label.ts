import { assertLabelUrl } from "./label-download";
type Request = <T extends Record<string, unknown>>(endpoint: string, method: string, params: Record<string, unknown>) => Promise<T>;
export type LabelState = "none" | "processing" | "unknown" | "sources_ready" | "ready";

/** Durable callbacks must persist state before allowing any external mutation. */
export async function getLabelSources(request: Request, orderId: number, store: {
  state: LabelState; sources: string[] | null;
  claim: () => Promise<boolean>;
  saveSources: (sources: string[]) => Promise<void>;
  markUnknown: () => Promise<void>;
  markRejected: () => Promise<void>;
}) {
  if (store.state === "sources_ready" && store.sources?.length) {
    store.sources.forEach(assertLabelUrl); return store.sources;
  }
  if (store.state !== "none" || !await store.claim()) throw new Error("A geração desta etiqueta já está em andamento ou sem confirmação. Confira a etiqueta no painel de fretes do Omie antes de qualquer nova solicitação.");
  let response;
  try { response = await request<{ cCodStatus?: string; cDesStatus?: string; listaEtiqueta?: { cUrlEtiqueta?: string }[] }>("/produtos/frete/", "GerarEtiqueta", { nIdPedido: orderId }); }
  catch {
    await store.markUnknown();
    throw new Error("O Omie não confirmou a geração da etiqueta. Não será feita nova solicitação automática. Confira o painel de fretes do pedido.");
  }
  if (response.cCodStatus != null && String(response.cCodStatus) !== "0") {
    await store.markRejected();
    throw new Error(response.cDesStatus || "O Omie recusou a geração da etiqueta.");
  }
  const sources = response.listaEtiqueta?.map(label => label.cUrlEtiqueta ?? "") ?? [];
  if (String(response.cCodStatus ?? "") !== "0" || !sources.length || sources.length > 20 || sources.some(url => !url)) {
    await store.markUnknown(); throw new Error("O Omie não retornou os PDFs da etiqueta. Confira o painel de fretes antes de tentar gerar novamente.");
  }
  // Save returned links even if a download or layout check fails. Never generate again just to retry a PDF.
  await store.saveSources(sources);
  sources.forEach(assertLabelUrl);
  return sources;
}
