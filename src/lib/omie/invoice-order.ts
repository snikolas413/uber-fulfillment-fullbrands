export type BillingOutcome = "confirmed" | "submitted" | "unknown" | "rejected" | "blocked";
export type BillingControlState = "billing_processing" | "billing_submitted" | "billing_unknown" | "billing_rejected";
export type BillingStatus = {
  codigo_pedido?: number; codigo_pedido_integracao?: string; numero_pedido?: string; etapa?: string;
  faturada?: string; cancelada?: string;
  ListaNfe?: { numero_nfe?: string; chave_nfe?: string; serie_nfe?: string; protocolo?: string | number; status_nfe?: string; data_emissao?: string; danfe?: string; xml_distr?: string }[];
};
type Request = <T extends Record<string, unknown>>(endpoint: string, method: string, params: Record<string, unknown>) => Promise<T>;
type BillingResult = { outcome: BillingOutcome; message: string; snapshot?: BillingStatus };
const isBilled = (status: BillingStatus) => status.faturada === "S" || Boolean(status.ListaNfe?.some(nfe => nfe.numero_nfe || nfe.chave_nfe));

/** Bills an existing order only after an exclusive durable claim. Never retries issuance. */
export async function invoiceExistingOrder({ request, orderId, integrationCode, carrierId, claim, settle }: {
  request: Request; orderId: number; integrationCode: string; carrierId: number;
  claim: () => Promise<boolean>; settle: (state: BillingControlState) => Promise<void>;
}): Promise<BillingResult> {
  let claimed = false;
  let requested = false;
  let accepted = false;
  const readStatus = async () => {
    const status = await request<BillingStatus>("/produtos/pedido/", "StatusPedido", { codigo_pedido: orderId, codigo_pedido_integracao: integrationCode });
    if (status.codigo_pedido !== orderId || status.codigo_pedido_integracao !== integrationCode) throw new Error("O vínculo do pedido não foi confirmado na consulta fiscal.");
    return status;
  };
  try {
    const response = await request<{ pedido_venda_produto?: {
      cabecalho?: { codigo_pedido?: number; codigo_pedido_integracao?: string; etapa?: string; bloqueado?: string };
      infoCadastro?: { faturado?: string; cancelado?: string };
      frete?: { codigo_transportadora?: number; valor_frete?: number };
    } }>("/produtos/pedido/", "ConsultarPedido", { codigo_pedido: orderId });
    const order = response.pedido_venda_produto;
    if (order?.cabecalho?.codigo_pedido !== orderId || order.cabecalho.codigo_pedido_integracao !== integrationCode) throw new Error("O vínculo do pedido com o Omie não foi confirmado. Nenhuma emissão foi solicitada.");
    if (order.infoCadastro?.cancelado === "S") throw new Error("Pedido cancelado no Omie. Nenhuma emissão foi solicitada.");
    if (order.infoCadastro?.faturado === "S") {
      const snapshot = await readStatus();
      if (!isBilled(snapshot)) throw new Error("O Omie retornou situações fiscais divergentes. Atualize o pedido antes de faturar.");
      return { outcome: "confirmed", message: "O pedido já estava faturado no Omie. Dados sincronizados, sem nova emissão.", snapshot };
    }
    if (order.cabecalho.bloqueado === "S") throw new Error("Pedido bloqueado no Omie. Confira a liberação antes de faturar.");
    if (!["10", "20", "30", "40", "50"].includes(String(order.cabecalho.etapa))) throw new Error("A etapa atual do Omie não permite este faturamento.");
    const amount = order.frete?.valor_frete === undefined ? 0 : order.frete.valor_frete;
    if (order.frete?.codigo_transportadora !== carrierId || !Number.isFinite(amount) || amount !== 0) throw new Error("Confira a transportadora e o frete grátis no Omie antes de faturar.");
    claimed = await claim();
    if (!claimed) return { outcome: "blocked", message: "Este pedido possui uma solicitação de faturamento em andamento ou sem confirmação. Use Atualizar Omie; nenhuma nova emissão foi solicitada." };
    if (order.cabecalho.etapa !== "50") {
      const moved = await request<{ codigo_status?: string; descricao_status?: string }>("/produtos/pedido/", "TrocarEtapaPedido", {
        codigo_pedido: orderId, codigo_pedido_integracao: integrationCode, etapa: "50",
      });
      if (String(moved.codigo_status ?? "") !== "0") throw new Error(moved.descricao_status || "O Omie não confirmou a preparação para faturamento.");
    }
    const current = await readStatus();
    if (current.cancelada === "S") throw new Error("O pedido foi cancelado no Omie. Nenhuma emissão foi solicitada.");
    if (isBilled(current)) {
      await settle("billing_submitted");
      return { outcome: "confirmed", message: "Faturamento já identificado no Omie, sem nova emissão.", snapshot: current };
    }
    if (current.etapa !== "50") throw new Error("O pedido não foi confirmado na etapa de faturamento. Nenhuma emissão foi solicitada.");
    const params = { nCodPed: orderId, cCodIntPed: integrationCode };
    const validation = await request<{ cCodStatus?: string; cDescStatus?: string }>("/produtos/pedidovendafat/", "ValidarPedidoVenda", params);
    if (String(validation.cCodStatus ?? "") !== "0") throw new Error(validation.cDescStatus || "O Omie não aprovou a validação fiscal. Nenhuma emissão foi solicitada.");
    requested = true;
    const result = await request<{ cCodStatus?: string; cDescStatus?: string }>("/produtos/pedidovendafat/", "FaturarPedidoVenda", params);
    if (result.cCodStatus != null && String(result.cCodStatus) !== "0") {
      throw new Error(result.cDescStatus || "O Omie recusou o faturamento.");
    }
    if (String(result.cCodStatus ?? "") !== "0") throw new Error("O Omie não confirmou o resultado da emissão.");
    accepted = true;
    await settle("billing_submitted");
    const snapshot = await readStatus();
    return isBilled(snapshot)
      ? { outcome: "confirmed", message: "Faturamento confirmado no Omie.", snapshot }
      : { outcome: "submitted", message: "O Omie aceitou o faturamento; a confirmação da NF-e está pendente. Use Atualizar Omie, sem reenviar a emissão.", snapshot };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Falha na comunicação com o Omie.";
    const state = accepted ? "billing_submitted" : requested ? "billing_unknown" : "billing_rejected";
    if (claimed) {
      try { await settle(state); }
      catch { return { outcome: "blocked", message: "Não foi possível salvar o resultado local do faturamento. Confira o pedido no Omie e sincronize antes de qualquer nova tentativa." }; }
    }
    return { outcome: accepted ? "submitted" : requested ? "unknown" : "rejected", message: requested
      ? (accepted ? "O Omie aceitou a solicitação, mas a conferência não foi concluída. " : "O resultado do faturamento não foi confirmado. ") + reason + " Use Atualizar Omie; não reenvie a emissão."
      : reason };
  }
}
