type Request = <T extends Record<string, unknown>>(endpoint: string, method: string, params: Record<string, unknown>) => Promise<T>;
export class ItemIcmsError extends Error {}
export type ItemIcms = {
  cod_sit_trib_icms: string; origem_icms: string; modalidade_icms: string;
  perc_red_base_icms: number; aliq_icms: number; perc_fcp_icms?: number;
  base_icms?: number; valor_icms?: number;
};
export type ItemIcmsSn = { cod_sit_trib_icms_sn: string; origem_icms_sn: string; aliq_icms_sn: number };

export function hasCompleteItemIcms(taxes: Record<string, unknown> | undefined, simples: boolean) {
  if (simples) {
    const sn = taxes?.icms_sn as Partial<ItemIcmsSn> | undefined;
    return /^\d{3}$/.test(sn?.cod_sit_trib_icms_sn ?? "") && /^[0-8]$/.test(sn?.origem_icms_sn ?? "") && Number.isFinite(sn?.aliq_icms_sn);
  }
  const icms = taxes?.icms as Partial<ItemIcms> | undefined;
  if (!icms || !/^\d{2}$/.test(icms.cod_sit_trib_icms ?? "") || !/^[0-8]$/.test(icms.origem_icms ?? "") ||
    !/^[0-3]$/.test(icms.modalidade_icms ?? "") || !Number.isFinite(icms.perc_red_base_icms) || !Number.isFinite(icms.aliq_icms)) return false;
  if (Number(icms.aliq_icms) > 0) {
    if (!Number.isFinite(icms.base_icms) || Number(icms.base_icms) <= 0 || !Number.isFinite(icms.valor_icms)) return false;
    const expected = Math.round(Number(icms.base_icms) * Number(icms.aliq_icms)) / 100;
    if (Math.abs(expected - Number(icms.valor_icms)) > 0.010001) return false;
  }
  return true;
}

const percent = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new ItemIcmsError("O cenário não retornou " + field + " válido para o ICMS.");
  return value;
};

/** Resolve the editable ICMS fields from the selected scenario and product, not a screenshot amount. */
export async function resolveItemIcms(request: Request, { scenarioId, customerId, productId, finalConsumer, simples = false }: {
  scenarioId: number; customerId: number; productId: number; finalConsumer: string; simples?: boolean;
}): Promise<{ icms: ItemIcms } | { icms_sn: ItemIcmsSn }> {
  if (![scenarioId, customerId, productId].every(id => Number.isSafeInteger(id) && id > 0) || !["S", "N"].includes(finalConsumer)) {
    throw new ItemIcmsError("Confirme o cenário, cliente e produto antes de preencher o ICMS do item.");
  }
  const [scenario, product] = await Promise.all([
    request<{ codigo_cenario?: number; codigo_cliente_omie?: number; codigo_produto?: number; consumo_final?: string; impostos?: Record<string, unknown> }>("/geral/cenarios/", "ListarImpostosCenario", {
      codigo_cenario: scenarioId, codigo_cliente_omie: customerId, codigo_produto: productId, consumo_final: finalConsumer,
    }),
    request<{ codigo_produto?: number; recomendacoes_fiscais?: { origem_mercadoria?: string } }>("/geral/produtos/", "ConsultarProduto", { codigo_produto: productId }),
  ]);
  if (scenario.codigo_cenario !== scenarioId || scenario.codigo_cliente_omie !== customerId || scenario.codigo_produto !== productId ||
    scenario.consumo_final !== finalConsumer || product.codigo_produto !== productId || !scenario.impostos) {
    throw new ItemIcmsError("O Omie não confirmou os dados fiscais do cenário e do produto.");
  }
  const origin = product.recomendacoes_fiscais?.origem_mercadoria?.trim() ?? "";
  if (!/^[0-8]$/.test(origin)) throw new ItemIcmsError("Preencha a origem da mercadoria no cadastro do produto no Omie.");
  const taxes = scenario.impostos;
  if (simples) {
    const cst = typeof taxes.csosn === "string" ? taxes.csosn.trim() : "";
    if (!/^\d{3}$/.test(cst)) throw new ItemIcmsError("O cenário não retornou CSOSN para o item.");
    return { icms_sn: { cod_sit_trib_icms_sn: cst, origem_icms_sn: origin, aliq_icms_sn: percent(taxes.aliquota_icms_simples, "alíquota do Simples Nacional") } };
  }
  const cst = typeof taxes.cst_icms === "string" ? taxes.cst_icms.trim() : "";
  const mode = typeof taxes.modalidade_bc_icms === "string" ? taxes.modalidade_bc_icms.trim() : "";
  if (!/^\d{2}$/.test(cst) || !/^[0-3]$/.test(mode)) throw new ItemIcmsError("O cenário não retornou CST e modalidade da base de ICMS válidos para o item.");
  return { icms: {
    cod_sit_trib_icms: cst, origem_icms: origin, modalidade_icms: mode,
    perc_red_base_icms: percent(taxes.reducao_bc_icms, "redução da base"), aliq_icms: percent(taxes.aliquota_icms, "alíquota"),
    ...(taxes.perc_fcp_icms !== undefined ? { perc_fcp_icms: percent(taxes.perc_fcp_icms, "FCP") } : {}),
    // Base and amount are calculated by Omie for this order, not copied from an example.
  } };
}

/** Preserve tax settings, leaving dependent bases and amounts for Omie to recalculate. */
export function preserveOtherItemTaxes(taxes: Record<string, unknown> | undefined) {
  const fields: Record<string, string[]> = {
    ipi: ["cod_sit_trib_ipi", "aliq_ipi", "enquadramento_ipi", "tipo_calculo_ipi", "valor_unid_trib_ipi"],
    pis_padrao: ["cod_sit_trib_pis", "aliq_pis", "tipo_calculo_pis", "valor_unid_trib_pis"],
    cofins_padrao: ["cod_sit_trib_cofins", "aliq_cofins", "tipo_calculo_cofins", "valor_unid_trib_cofins"],
    icms_st: ["cod_sit_trib_icms_st", "modalidade_icms_st", "perc_red_base_icms_st", "aliq_icms_st", "margem_icms_st", "aliq_icms_opprop", "perc_red_base_icms_op", "cest", "perc_fcp_icms_st"],
    icms_ie: ["aliq_icms_FCP", "aliq_interna_uf_destino", "aliq_interestadual", "aliq_partilha_icms"],
  };
  return Object.fromEntries(Object.entries(fields).flatMap(([group, keys]) => {
    const values = taxes?.[group];
    if (!values || typeof values !== "object" || Array.isArray(values)) return [];
    const value = values as Record<string, unknown>;
    const settings = Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
    return Object.keys(settings).length ? [[group, settings]] : [];
  }));
}

export async function simulateOtherItemTaxes(request: Request, { scenarioId, customerId, productId, quantity, unitPrice, deliveryState }: {
  scenarioId: number; customerId: number; productId: number; quantity: number; unitPrice: number; deliveryState: string;
}) {
  const result = await request<{ codigo_cliente?: number; det_simul_resp?: { codigo_cenario_impostos_item?: number; produto_simul_resp?: { codigo_produto?: number }; imposto?: Record<string, unknown> }[] }>("/produtos/pedido/", "SimularImpostos", {
    codigo_cliente: customerId, consumidor_final: "S", uf_entrega: deliveryState,
    frete_simul: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0 },
    det_simul: [{ codigo_cenario_impostos_item: scenarioId, produto_simul: { codigo_produto: productId, quantidade: quantity, valor_unitario: unitPrice, valor_desconto: 0 } }],
  });
  const item = result.det_simul_resp?.[0];
  if (result.codigo_cliente !== customerId || result.det_simul_resp?.length !== 1 || Number(item?.codigo_cenario_impostos_item) !== scenarioId ||
    item?.produto_simul_resp?.codigo_produto !== productId || !item.imposto) throw new ItemIcmsError("O Omie não confirmou os impostos do item na simulação do cenário selecionado.");
  return preserveOtherItemTaxes(item.imposto);
}
