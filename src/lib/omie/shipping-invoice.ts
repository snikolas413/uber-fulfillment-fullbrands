type Request = <T extends Record<string, unknown>>(endpoint: string, method: string, params: Record<string, unknown>) => Promise<T>;
export type LabelInvoice = { key: string; number: string; series: string; issuedDate: string; issuedAt?: string; orderNumber: string };

export function validNfeKey(key: string) {
  if (!/^\d{44}$/.test(key) || key.slice(20, 22) !== "55") return false;
  let sum = 0;
  for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(key[i]) * weight;
  const digit = 11 - sum % 11;
  return Number(key[43]) === (digit >= 10 ? 0 : digit);
}

/** Reads only. Requires an authorized, non-cancelled outgoing NF-e linked to this exact order. */
export async function readShippingInvoice(request: Request, orderId: number, integrationCode: string): Promise<LabelInvoice> {
  const order = await request<{
    codigo_pedido?: number; codigo_pedido_integracao?: string; numero_pedido?: string; cancelada?: string; faturada?: string;
    ListaNfe?: { chave_nfe?: string; numero_nfe?: string; serie_nfe?: string; status_nfe?: string; protocolo?: string | number; tipo?: string }[];
  }>("/produtos/pedido/", "StatusPedido", { codigo_pedido: orderId, codigo_pedido_integracao: integrationCode });
  if (order.codigo_pedido !== orderId || order.codigo_pedido_integracao !== integrationCode || order.cancelada === "S" || order.faturada !== "S") {
    throw new Error("O Omie ainda não confirmou o faturamento deste pedido, ou ele foi cancelado. Nenhuma etiqueta foi solicitada.");
  }
  const notes = order.ListaNfe?.filter(note => note.status_nfe === "006" && note.tipo === "S" && note.protocolo && validNfeKey(note.chave_nfe ?? "")) ?? [];
  if (notes.length !== 1) throw new Error("Não foi possível identificar uma única NF-e de saída autorizada para este pedido. Confira no Omie.");
  const note = notes[0];
  const nf = await request<{
    compl?: { cChaveNFe?: string; nIdPedido?: number };
    ide?: { nNF?: string; serie?: string; dEmi?: string; hEmi?: string; dCan?: string; dInut?: string; cDeneg?: string; mod?: string; tpNF?: string };
  }>("/produtos/nfconsultar/", "ConsultarNF", { nIdPedido: orderId, cChaveNFe: note.chave_nfe });
  const key = nf.compl?.cChaveNFe ?? "";
  const ide = nf.ide;
  if (nf.compl?.nIdPedido !== orderId || key !== note.chave_nfe || !ide || ide.dCan || ide.dInut || ide.cDeneg !== "N" || ide.mod !== "55" || ide.tpNF !== "1" ||
    !/^\d{1,9}$/.test(ide.nNF ?? "") || !/^\d{1,3}$/.test(ide.serie ?? "") ||
    Number(key.slice(25, 34)) !== Number(ide.nNF) || Number(key.slice(22, 25)) !== Number(ide.serie) ||
    Number(note.numero_nfe) !== Number(ide.nNF) || Number(note.serie_nfe) !== Number(ide.serie) || !/^\d{2}\/\d{2}\/\d{4}$/.test(ide.dEmi ?? "")) {
    throw new Error("A nota fiscal não corresponde ao pedido ou seus dados não foram confirmados. Etiqueta bloqueada para evitar chave incorreta.");
  }
  return { key, number: ide.nNF!, series: ide.serie!, issuedDate: ide.dEmi!,
    ...(ide.hEmi && /^\d{2}:\d{2}:\d{2}$/.test(ide.hEmi) ? { issuedAt: ide.dEmi!.split("/").reverse().join("-") + "T" + ide.hEmi + "-03:00" } : {}),
    orderNumber: order.numero_pedido ?? String(orderId) };
}
