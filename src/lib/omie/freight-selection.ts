export type FreightQuote = {
  nIdFrete: number;
  cTipoServico: string;
  cDescricaoServico: string;
  cNomeTransportadora?: string;
  nDiasEntrega: number;
  nValorFrete: number;
};

type Order = {
  cabecalho?: { codigo_pedido?: number; codigo_pedido_integracao?: string };
  infoCadastro?: { cancelado?: string; faturado?: string };
  frete?: { codigo_transportadora?: number; valor_frete?: number; quantidade_volumes?: number; previsao_entrega?: string; modalidade?: string };
};

type Request = <T extends Record<string, unknown>>(endpoint: string, method: string, params: Record<string, unknown>) => Promise<T>;
export class FreightSelectionError extends Error {
  constructor(message: string, public readonly outcome: "not_selected" | "unknown" | "selected" = "not_selected") { super(message); }
}

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const miniNames = new Set(["minienvios", "correiosminienvios", "minienvioscorreios"]);
const correiosNames = new Set(["correios", "empresabrasileiradecorreiosetelegrafos"]);

function checkResponse(response: { cCodStatus?: string; cDesStatus?: string }) {
  if (response.cCodStatus != null && response.cCodStatus !== "" && String(response.cCodStatus) !== "0") {
    throw new FreightSelectionError(response.cDesStatus || "O Omie não confirmou a operação de frete.");
  }
}

async function readOrder(request: Request, orderId: number, integrationCode: string): Promise<Order> {
  const response = await request<{ pedido_venda_produto?: Order }>("/produtos/pedido/", "ConsultarPedido", { codigo_pedido: orderId });
  const order = response.pedido_venda_produto;
  if (order?.cabecalho?.codigo_pedido !== orderId || order.cabecalho.codigo_pedido_integracao !== integrationCode) {
    throw new FreightSelectionError("O vínculo entre o pedido local e o Omie não foi confirmado. Seleção de frete bloqueada.");
  }
  if (order.infoCadastro?.cancelado === "S" || order.infoCadastro?.faturado === "S") {
    throw new FreightSelectionError("O pedido está cancelado ou faturado no Omie. Seleção de frete bloqueada.");
  }
  return order;
}

/** Selects a quoted freight option. Does not generate freight, labels or invoices. */
export async function selectMiniEnviosFreight(request: Request, orderId: number, integrationCode: string) {
  const before = await readOrder(request, orderId, integrationCode);
  const carrierId = before.frete?.codigo_transportadora;
  if (!carrierId || !Number.isSafeInteger(carrierId) || carrierId <= 0) {
    throw new FreightSelectionError("Defina a transportadora EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS no pedido antes de selecionar Mini Envios.");
  }
  const carrier = await request<{ codigo_cliente_omie?: number; razao_social?: string; nome_fantasia?: string }>("/geral/clientes/", "ConsultarCliente", { codigo_cliente_omie: carrierId });
  if (carrier.codigo_cliente_omie !== carrierId || ![carrier.razao_social, carrier.nome_fantasia].some(name => typeof name === "string" && correiosNames.has(normalize(name)))) {
    throw new FreightSelectionError("A transportadora do pedido não foi confirmada como Correios. Nenhuma opção de frete foi selecionada.");
  }
  const response = await request<{ listaCotacao?: FreightQuote[]; cCodStatus?: string; cDesStatus?: string }>("/produtos/frete/", "CotarFrete", { nIdPedido: orderId });
  checkResponse(response);
  if (!Array.isArray(response.listaCotacao)) throw new FreightSelectionError("O Omie não retornou opções válidas para a cotação de frete.");
  const matches = response.listaCotacao.filter(quote => typeof quote.cDescricaoServico === "string" && miniNames.has(normalize(quote.cDescricaoServico)) &&
    (!quote.cNomeTransportadora || correiosNames.has(normalize(quote.cNomeTransportadora))));
  if (!matches.length) throw new FreightSelectionError("Mini Envios não está disponível na cotação deste pedido. Confira os dados de entrega, peso e volumes no Omie.");
  if (matches.length !== 1) throw new FreightSelectionError("A cotação retornou mais de uma opção Mini Envios. Confira a opção correta no Omie antes de continuar.");
  const quote = matches[0];
  if (!Number.isSafeInteger(quote.nIdFrete) || quote.nIdFrete <= 0 || typeof quote.cTipoServico !== "string" || !quote.cTipoServico.trim() ||
    !Number.isFinite(quote.nValorFrete) || quote.nValorFrete < 0 || !Number.isInteger(quote.nDiasEntrega) || quote.nDiasEntrega < 0) {
    throw new FreightSelectionError("A opção Mini Envios retornou dados inválidos. Nenhum frete foi selecionado.");
  }
  // Recheck order identity, state and carrier immediately before selecting a quote.
  const current = await readOrder(request, orderId, integrationCode);
  if (current.frete?.codigo_transportadora !== carrierId) throw new FreightSelectionError("A transportadora mudou durante a cotação. Atualize o pedido antes de continuar.");
  let selection;
  try {
    selection = await request<{ cCodStatus?: string; cDesStatus?: string }>("/produtos/frete/", "SelecionarFrete", { nIdFrete: quote.nIdFrete, lGratis: true });
  } catch {
    throw new FreightSelectionError("O resultado da seleção de Mini Envios não foi confirmado. Confira a opção salva no Omie antes de tentar novamente.", "unknown");
  }
  checkResponse(selection);
  try {
    const saved = await readOrder(request, orderId, integrationCode);
    if (saved.frete?.codigo_transportadora !== carrierId || Number(saved.frete?.valor_frete) !== 0) {
      throw new Error("Frete grátis não confirmado");
    }
    return { quote, carrierId, freight: saved.frete, freeForCustomer: true as const };
  } catch {
    throw new FreightSelectionError("O Omie aceitou a seleção de Mini Envios, mas a conferência do pedido com frete grátis não foi concluída. Confira o pedido no ERP antes de repetir a operação.", "selected");
  }
}
