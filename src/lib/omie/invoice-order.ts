import { simulateItemTaxes, hasCompleteItemIcms } from "@/lib/omie/item-icms";
import { withDeliveryInvoiceNote, sameInvoiceNotes } from "@/lib/omie/invoice-notes";
import { hasNoReceivablesPolicy, type PaymentOrder } from "@/lib/omie/payment-policy";

export type BillingOutcome = "confirmed" | "submitted" | "unknown" | "rejected" | "blocked";
export type BillingControlState = "billing_processing" | "billing_submitting" | "billing_submitted" | "billing_unknown" | "billing_rejected";
export type BillingStatus = {
  codigo_pedido?: number; codigo_pedido_integracao?: string; numero_pedido?: string; etapa?: string;
  faturada?: string; cancelada?: string;
  ListaNfe?: { numero_nfe?: string; chave_nfe?: string; serie_nfe?: string; protocolo?: string | number; status_nfe?: string; tipo?: string; data_emissao?: string; danfe?: string; xml_distr?: string }[];
};
type Request = <T extends Record<string, unknown>>(endpoint: string, method: string, params: Record<string, unknown>) => Promise<T>;
type BillingItem = {
  ide?: { codigo_item?: number; codigo_item_integracao?: string; simples_nacional?: string };
  produto?: { codigo_produto?: number; codigo?: string; quantidade?: number; valor_unitario?: number; cfop?: string; ncm?: string; unidade?: string; tipo_desconto?: string; percentual_desconto?: number; valor_desconto?: number };
  inf_adic?: { codigo_cenario_impostos_item?: number | string; nao_gerar_financeiro?: string; nao_movimentar_estoque?: string };
  imposto?: Record<string, unknown>;
};
type BillingOrder = Omit<PaymentOrder, "cabecalho" | "det"> & {
  cabecalho?: { codigo_parcela?: string; nao_gerar_boleto?: string; codigo_pedido?: number; codigo_pedido_integracao?: string; codigo_cenario_impostos?: number | string; codigo_cliente?: number; etapa?: string; bloqueado?: string };
  informacoes_adicionais?: { consumidor_final?: string; dados_adicionais_nf?: string; outros_detalhes?: { cEstadoOd?: string } };
  infoCadastro?: { faturado?: string; cancelado?: string };
  frete?: { codigo_transportadora?: number; valor_frete?: number; valor_seguro?: number; outras_despesas?: number };
  det?: BillingItem[];
};
type BillingResult = { outcome: BillingOutcome; message: string; snapshot?: BillingStatus; taxScenarioRefreshRequested?: boolean; retryAt?: number };
const isBilled = (status: BillingStatus) => status.faturada === "S" || Boolean(status.ListaNfe?.some(nfe => nfe.numero_nfe || nfe.chave_nfe));
const hasIcmsSituation = (item: BillingItem) => hasCompleteItemIcms(item.imposto, item.ide?.simples_nacional === "S");

async function scenarioRefreshItems(request: Request, order: BillingOrder) {
  if (!Array.isArray(order.det) || !order.det.length) throw new Error("O Omie não retornou os itens para conferência fiscal.");
  const updates = [];
  for (const item of order.det.filter(item => !hasIcmsSituation(item))) {
    if (Number(item.produto?.valor_desconto ?? 0) !== 0 || Number(item.produto?.percentual_desconto ?? 0) !== 0 ||
      Number(order.frete?.valor_seguro ?? 0) !== 0 || Number(order.frete?.outras_despesas ?? 0) !== 0) {
      throw new Error("O pedido possui descontos ou despesas fora do modelo 1107. Confira o cálculo fiscal no Omie antes de faturar.");
    }
    const scenario = Number(item.inf_adic?.codigo_cenario_impostos_item ?? order.cabecalho?.codigo_cenario_impostos);
    if (!Number.isSafeInteger(scenario) || scenario <= 0 || !Number.isSafeInteger(item.ide?.codigo_item) || !item.ide?.codigo_item ||
      !Number.isSafeInteger(item.produto?.codigo_produto) || !item.produto?.codigo_produto ||
      !Number.isFinite(item.produto?.quantidade) || Number(item.produto?.quantidade) <= 0 || !Number.isFinite(item.produto?.valor_unitario)) {
      throw new Error("Não foi possível confirmar o cenário e os dados do item para atualizar os impostos. Nenhuma emissão foi solicitada.");
    }
    const taxFields = await simulateItemTaxes(request, { scenarioId: scenario, customerId: Number(order.cabecalho?.codigo_cliente),
      productId: item.produto.codigo_produto, quantity: Number(item.produto.quantidade), unitPrice: Number(item.produto.valor_unitario),
      deliveryState: order.informacoes_adicionais?.outros_detalhes?.cEstadoOd?.trim().toUpperCase() ?? "" });
    updates.push({
      ide: { codigo_item: item.ide.codigo_item, ...(item.ide.codigo_item_integracao ? { codigo_item_integracao: item.ide.codigo_item_integracao } : {}) },
      produto: { codigo_produto: item.produto.codigo_produto, quantidade: item.produto.quantidade, valor_unitario: item.produto.valor_unitario,
        ...Object.fromEntries((["codigo", "cfop", "ncm", "unidade", "tipo_desconto", "percentual_desconto", "valor_desconto"] as const)
          .filter(key => item.produto?.[key] !== undefined).map(key => [key, item.produto?.[key]])) },
      inf_adic: { codigo_cenario_impostos_item: scenario,
        ...(item.inf_adic?.nao_gerar_financeiro ? { nao_gerar_financeiro: item.inf_adic.nao_gerar_financeiro } : {}),
        ...(item.inf_adic?.nao_movimentar_estoque ? { nao_movimentar_estoque: item.inf_adic.nao_movimentar_estoque } : {}) },
      imposto: taxFields,
    });
  }
  return updates;
}

/** Bills an existing order only after an exclusive durable claim. Never retries issuance. */
export async function invoiceExistingOrder({ request, orderId, integrationCode, carrierId, separationStage, claim, settle }: {
  request: Request; orderId: number; integrationCode: string; carrierId: number; separationStage: string;
  claim: () => Promise<boolean>; settle: (state: BillingControlState) => Promise<void>;
}): Promise<BillingResult> {
  let claimed = false;
  let requested = false;
  let accepted = false;
  let taxScenarioRefreshRequested = false;
  const readOrder = async () => (await request<{ pedido_venda_produto?: BillingOrder }>("/produtos/pedido/", "ConsultarPedido", { codigo_pedido: orderId })).pedido_venda_produto;
  const readStatus = async () => {
    const status = await request<BillingStatus>("/produtos/pedido/", "StatusPedido", { codigo_pedido: orderId, codigo_pedido_integracao: integrationCode });
    if (status.codigo_pedido !== orderId || status.codigo_pedido_integracao !== integrationCode) throw new Error("O vínculo do pedido não foi confirmado na consulta fiscal.");
    return status;
  };
  try {
    let order = await readOrder();
    if (order?.cabecalho?.codigo_pedido !== orderId || order.cabecalho.codigo_pedido_integracao !== integrationCode) throw new Error("O vínculo do pedido com o Omie não foi confirmado. Nenhuma emissão foi solicitada.");
    if (order.infoCadastro?.cancelado === "S") throw new Error("Pedido cancelado no Omie. Nenhuma emissão foi solicitada.");
    if (order.infoCadastro?.faturado === "S") {
      const snapshot = await readStatus();
      if (!isBilled(snapshot)) throw new Error("O Omie retornou situações fiscais divergentes. Atualize o pedido antes de faturar.");
      return { outcome: "confirmed", message: "O pedido já estava faturado no Omie. Dados sincronizados, sem nova emissão.", snapshot };
    }
    if (!["10", "20", "30", "40"].includes(separationStage) || ![separationStage, "50"].includes(String(order.cabecalho.etapa))) throw new Error("O pedido não está na etapa de separação confirmada. Confira a tela de Separação antes de faturar.");
    if (order.cabecalho.bloqueado === "S") throw new Error("Pedido bloqueado no Omie. Confira a liberação antes de faturar.");
    if (!hasNoReceivablesPolicy(order)) throw new Error("Corrija o vencimento para 31/12/2026 e confirme que o pedido não gera contas a receber nem boletos antes de faturar. Nenhuma emissão foi solicitada.");
    if (!["10", "20", "30", "40", "50"].includes(String(order.cabecalho.etapa))) throw new Error("A etapa atual do Omie não permite este faturamento.");
    const amount = order.frete?.valor_frete === undefined ? 0 : order.frete.valor_frete;
    if (order.frete?.codigo_transportadora !== carrierId || !Number.isFinite(amount) || amount !== 0) throw new Error("Confira a transportadora e o frete grátis no Omie antes de faturar.");
    claimed = await claim();
    if (!claimed) return { outcome: "blocked", message: "Este pedido possui uma solicitação de faturamento em andamento ou sem confirmação. Use Atualizar Omie; nenhuma nova emissão foi solicitada." };
    const refreshItems = await scenarioRefreshItems(request, order);
    const requiredNotes = withDeliveryInvoiceNote(order.informacoes_adicionais?.dados_adicionais_nf);
    const noteNeedsUpdate = requiredNotes !== (order.informacoes_adicionais?.dados_adicionais_nf ?? "");
    if (refreshItems.length || noteNeedsUpdate) {
      taxScenarioRefreshRequested = refreshItems.length > 0;
      const refreshed = await request<{ codigo_status?: string; descricao_status?: string }>("/produtos/pedido/", "AlterarPedidoVenda", {
        cabecalho: { codigo_pedido: orderId, codigo_pedido_integracao: integrationCode },
        ...(refreshItems.length ? { det: refreshItems } : {}),
        ...(noteNeedsUpdate ? { informacoes_adicionais: { ...order.informacoes_adicionais, dados_adicionais_nf: requiredNotes } } : {}),
      });
      if (String(refreshed.codigo_status ?? "") !== "0") throw new Error(refreshed.descricao_status || "O Omie não confirmou a atualização das informações da NF-e. Nenhuma emissão foi solicitada.");
      const saved = await readOrder();
      if (saved?.cabecalho?.codigo_pedido !== orderId || saved.cabecalho.codigo_pedido_integracao !== integrationCode ||
        String(saved.cabecalho.codigo_cenario_impostos) !== String(order.cabecalho.codigo_cenario_impostos) ||
        ![separationStage, "50"].includes(String(saved.cabecalho.etapa)) ||
        saved.infoCadastro?.cancelado === "S" || saved.infoCadastro?.faturado === "S" || saved.cabecalho.bloqueado === "S" ||
        saved.frete?.codigo_transportadora !== carrierId || (saved.frete.valor_frete !== undefined && saved.frete.valor_frete !== 0)) {
        throw new Error("O pedido mudou durante a atualização das informações da NF-e. Consulte o Omie antes de continuar.");
      }
      if (!sameInvoiceNotes(saved.informacoes_adicionais?.dados_adicionais_nf, requiredNotes)) {
        throw new Error("O Omie não confirmou a frase de entrega nas informações complementares, preservando as observações anteriores. Nenhuma emissão foi solicitada.");
      }
      if (!hasNoReceivablesPolicy(saved)) throw new Error("A configuração sem contas a receber e sem boleto não foi preservada. Nenhuma emissão foi solicitada.");
      for (const original of refreshItems) {
        const item = saved.det?.find(candidate => candidate.ide?.codigo_item === original.ide.codigo_item);
        if (!item || item.produto?.codigo_produto !== original.produto.codigo_produto || item.produto.quantidade !== original.produto.quantidade ||
          item.produto.valor_unitario !== original.produto.valor_unitario || Number(item.inf_adic?.codigo_cenario_impostos_item ?? saved.cabecalho.codigo_cenario_impostos) !== original.inf_adic.codigo_cenario_impostos_item) {
          throw new Error("Não foi possível confirmar os dados do item após atualizar o cenário fiscal. Nenhuma emissão foi solicitada.");
        }
        if (!hasIcmsSituation(item)) throw new Error("O Omie não confirmou os campos e o cálculo de ICMS do produto " + (item.produto.codigo ?? item.produto.codigo_produto) + " após o preenchimento pelo cenário " + original.inf_adic.codigo_cenario_impostos_item + ". Nenhuma emissão foi solicitada.");
        const group = item.ide?.simples_nacional === "S" ? "icms_sn" : "icms";
        const expected = "icms" in original.imposto ? original.imposto.icms : original.imposto.icms_sn;
        const actual = item.imposto?.[group] as Record<string, unknown> | undefined;
        if (!expected || !actual || !Object.entries(expected).every(([key, value]) => actual[key] === value || (value === 0 && actual[key] === undefined))) throw new Error("O Omie não confirmou os parâmetros de ICMS gravados no item. Nenhuma emissão foi solicitada.");
      }
      order = saved;
    }
    if (order.cabecalho?.etapa !== "50") {
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
    // Persist the confirmation job before the external mutation. A lost response
    // is recovered by READS only, never by replaying FaturarPedidoVenda.
    await settle("billing_submitting");
    requested = true;
    const result = await request<{ cCodStatus?: string; cDescStatus?: string }>("/produtos/pedidovendafat/", "FaturarPedidoVenda", params);
    if (result.cCodStatus != null && String(result.cCodStatus) !== "0") {
      throw new Error(result.cDescStatus || "O Omie recusou o faturamento.");
    }
    if (String(result.cCodStatus ?? "") !== "0") throw new Error("O Omie não confirmou o resultado da emissão.");
    accepted = true;
    await settle("billing_submitted");
    return { outcome: "submitted", message: "Faturamento aceito pelo Omie. A NF-e será conferida na fila de confirmação, sem repetir a emissão.", taxScenarioRefreshRequested };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Falha na comunicação com o Omie.";
    const retryAt = (error as { retryAt?: number } | null)?.retryAt;
    const retry = typeof retryAt === "number" && Number.isFinite(retryAt) ? { retryAt } : {};
    const state = accepted ? "billing_submitted" : requested ? "billing_unknown" : "billing_rejected";
    if (claimed) {
      try { await settle(state); }
      catch { return { outcome: "blocked", ...retry, message: "Não foi possível salvar o resultado local do faturamento. Confira o pedido no Omie e sincronize antes de qualquer nova tentativa." }; }
    }
    return { outcome: accepted ? "submitted" : requested ? "unknown" : "rejected", ...retry, taxScenarioRefreshRequested, message: requested
      ? (accepted ? "O Omie aceitou a solicitação, mas a conferência não foi concluída. " : "O resultado do faturamento não foi confirmado. ") + reason + " Use Atualizar Omie; não reenvie a emissão."
      : reason };
  }
}
