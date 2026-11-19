type Order = {
  cabecalho?: { codigo_pedido?: number; codigo_pedido_integracao?: string; etapa?: string; bloqueado?: string };
  infoCadastro?: { cancelado?: string; faturado?: string; denegado?: string };
  frete?: { codigo_transportadora?: number; valor_frete?: number; valor_seguro?: number; outras_despesas?: number;
    quantidade_volumes?: number; modalidade?: string; previsao_entrega?: string };
};

/** The service is explicitly attested by the operator: ConsultarPedido omits it. */
export function inspectManualFreight(order: Order | undefined, orderId: number, integrationCode: string) {
  if (order?.cabecalho?.codigo_pedido !== orderId || order.cabecalho.codigo_pedido_integracao !== integrationCode) {
    throw new Error("O vínculo do pedido com o Omie não foi confirmado.");
  }
  if (!order.infoCadastro || order.infoCadastro.cancelado !== "N" || order.infoCadastro.faturado !== "N" ||
    order.infoCadastro.denegado === "S" || order.cabecalho.bloqueado !== "N" ||
    !["10", "20", "30", "40", "50"].includes(String(order.cabecalho.etapa))) {
    throw new Error("O pedido está faturado, cancelado, bloqueado ou fora da etapa permitida. Use Atualizar Omie.");
  }
  const freight = order.frete;
  if (freight?.codigo_transportadora !== 2757271756) throw new Error("Confirme a transportadora Correios no Omie antes de liberar.");
  // Omie omits numeric zeroes. The operator must first attest Mini Envios grátis.
  const amount = freight.valor_frete === undefined ? 0 : freight.valor_frete;
  if (!Number.isFinite(amount) || amount !== 0 ||
    (freight.valor_seguro !== undefined && freight.valor_seguro !== 0) ||
    (freight.outras_despesas !== undefined && freight.outras_despesas !== 0)) {
    throw new Error("O Omie ainda informa frete, seguro ou despesas para o cliente. Corrija para frete grátis.");
  }
  if (freight.modalidade !== "0" || !Number.isInteger(freight.quantidade_volumes) ||
    Number(freight.quantidade_volumes) < 1 || Number(freight.quantidade_volumes) > 20) {
    throw new Error("Confira o frete por conta do remetente e os volumes no Omie. O ajuste ainda não foi confirmado.");
  }
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(freight.previsao_entrega ?? "");
  const eta = match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  const date = new Date(eta + "T12:00:00Z");
  if (!eta || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== eta) {
    throw new Error("O Omie não retornou uma previsão válida da entrega. Confira a opção de frete selecionada.");
  }
  return { carrier_id: String(freight.codigo_transportadora), service_code: "Mini Envios", freight_amount: 0,
    package_count: freight.quantidade_volumes!, service_modality: "0", estimated_delivery_date: eta };
}
