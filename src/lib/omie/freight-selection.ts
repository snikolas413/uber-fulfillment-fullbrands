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
  constructor(message: string, public readonly outcome: "not_selected" | "unknown" | "selected" = "not_selected",
    public readonly diagnostic?: { stage: string; options: { id: number | null; type: string; description: string; carrier: string }[] }) { super(message); }
}

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const miniNames = new Set(["minienvios", "correiosminienvios", "minienvioscorreios"]);
const correiosNames = new Set(["correios", "empresabrasileiradecorreiosetelegrafos"]);

export function isMiniEnviosName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (miniNames.has(normalize(value))) return true;
  const words = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return /^(?:correios )?mini envios(?: correios)?(?: (?:contrato|ctr)(?: (?:ag|ta|agencia|agencias))?)?$/.test(words);
}

function isMiniQuote(quote: FreightQuote) {
  const description = typeof quote.cDescricaoServico === "string" ? quote.cDescricaoServico.trim() : "";
  const serviceMatches = isMiniEnviosName(description) || (!description && isMiniEnviosName(quote.cTipoServico));
  const carrier = typeof quote.cNomeTransportadora === "string" ? normalize(quote.cNomeTransportadora) : "";
  return serviceMatches && (!carrier || correiosNames.has(carrier) || carrier === "ect" || carrier.startsWith("correioscontrato"));
}

function quoteDiagnostic(quotes: FreightQuote[]) {
  const text = (value: unknown) => typeof value === "string" ? value.slice(0, 100) : "";
  return { stage: "match_quote", options: quotes.slice(0, 20).map(quote => ({
    id: Number.isSafeInteger(quote.nIdFrete) ? quote.nIdFrete : null,
    type: text(quote.cTipoServico), description: text(quote.cDescricaoServico), carrier: text(quote.cNomeTransportadora),
  })) };
}

type Carrier = { codigo_cliente_omie: number; razao_social?: string; nome_fantasia?: string; inativo?: string };

export async function resolveCorreiosCarrier(request: Request): Promise<number> {
  const matches: Carrier[] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const response = await request<{ pagina: number; total_de_paginas: number; clientes_cadastro?: Carrier[] }>("/geral/clientes/", "ListarClientes", {
      pagina: page, registros_por_pagina: 100, apenas_importado_api: "N",
      clientesFiltro: { razao_social: "EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS", inativo: "N" },
    });
    if (!Array.isArray(response.clientes_cadastro) || response.pagina !== page || !Number.isInteger(response.total_de_paginas) ||
      response.total_de_paginas < page || response.total_de_paginas > 100) {
      throw new FreightSelectionError("Não foi possível consultar o cadastro da transportadora Correios no Omie.");
    }
    pages = response.total_de_paginas;
    matches.push(...response.clientes_cadastro.filter(carrier => carrier.inativo === "N" && typeof carrier.razao_social === "string" &&
      normalize(carrier.razao_social) === "empresabrasileiradecorreiosetelegrafos"));
  }
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].codigo_cliente_omie) || matches[0].codigo_cliente_omie <= 0) {
    throw new FreightSelectionError("É necessário um único cadastro ativo de EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS no Omie. Confira a transportadora antes de continuar.");
  }
  return matches[0].codigo_cliente_omie;
}

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
  let before = await readOrder(request, orderId, integrationCode);
  let carrierId = before.frete?.codigo_transportadora;
  if (!carrierId) {
    carrierId = await resolveCorreiosCarrier(request);
    await request("/produtos/pedido/", "AlterarPedidoVenda", {
      cabecalho: { codigo_pedido: orderId, codigo_pedido_integracao: integrationCode },
      frete: { codigo_transportadora: carrierId },
    });
    before = await readOrder(request, orderId, integrationCode);
    if (before.frete?.codigo_transportadora !== carrierId) {
      throw new FreightSelectionError("A definição da transportadora Correios não foi confirmada no Omie. Atualize o pedido para conferir antes de repetir.");
    }
  }
  if (!Number.isSafeInteger(carrierId) || carrierId <= 0) {
    throw new FreightSelectionError("O pedido retornou um código de transportadora inválido.");
  }
  const carrier = await request<{ codigo_cliente_omie?: number; razao_social?: string; nome_fantasia?: string }>("/geral/clientes/", "ConsultarCliente", { codigo_cliente_omie: carrierId });
  if (carrier.codigo_cliente_omie !== carrierId || ![carrier.razao_social, carrier.nome_fantasia].some(name => typeof name === "string" && correiosNames.has(normalize(name)))) {
    throw new FreightSelectionError("A transportadora do pedido não foi confirmada como Correios. Nenhuma opção de frete foi selecionada.");
  }
  const response = await request<{ listaCotacao?: FreightQuote[]; cCodStatus?: string; cDesStatus?: string }>("/produtos/frete/", "CotarFrete", { nIdPedido: orderId });
  checkResponse(response);
  if (!Array.isArray(response.listaCotacao)) throw new FreightSelectionError("O Omie não retornou opções válidas para a cotação de frete.");
  if (!response.listaCotacao.length) throw new FreightSelectionError("O Omie retornou uma cotação sem opções de entrega. Nenhum frete foi selecionado.", "not_selected", quoteDiagnostic([]));
  const matches = response.listaCotacao.filter(isMiniQuote);
  const diagnostic = quoteDiagnostic(response.listaCotacao);
  if (!matches.length) {
    const names = diagnostic.options.slice(0, 5).map(option => option.description || option.type || "Sem descrição").join("; ");
    throw new FreightSelectionError("Não foi possível reconhecer Mini Envios nas opções retornadas pelo Omie. Opções: " + names + ". Nenhum frete foi selecionado.", "not_selected", diagnostic);
  }
  if (matches.length !== 1) throw new FreightSelectionError("A cotação retornou mais de uma opção Mini Envios. Confira a opção correta no Omie antes de continuar.", "not_selected", diagnostic);
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
