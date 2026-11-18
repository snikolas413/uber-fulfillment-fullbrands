export const PAYMENT_DUE_DATE = "31/12/2026";
export const PAYMENT_TERMS_CODE = "999";

export function initialPaymentSchedule() {
  return { parcela: [{ numero_parcela: 1, percentual: 100, data_vencimento: PAYMENT_DUE_DATE, nao_gerar_boleto: "S" }] };
}

export type PaymentOrder = {
  cabecalho?: { codigo_parcela?: string; nao_gerar_boleto?: string };
  det?: { inf_adic?: { nao_gerar_financeiro?: string } }[];
  lista_parcelas?: { parcela?: { data_vencimento?: string; nao_gerar_boleto?: string }[] };
};

/** Read-only guard. Never changes an order or requests an invoice. */
export function hasNoReceivablesPolicy(order: PaymentOrder) {
  const installments = order.lista_parcelas?.parcela;
  // Omie removes installments (and omits the header default) when every item
  // suppresses receivables. There is then no due date or boleto to generate.
  return Boolean(order.det?.length && order.det.every(item => item.inf_adic?.nao_gerar_financeiro === "S") &&
    (!installments?.length || installments.every(part =>
      part.data_vencimento === PAYMENT_DUE_DATE && part.nao_gerar_boleto === "S")));
}
