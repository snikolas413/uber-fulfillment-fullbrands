export type DeliveryType = {
  nCodEntrega: number;
  nCodTransp?: number;
  cCodIntEntrega?: string;
  cDescricao: string;
  cInativo: string;
};

export type DeliveryTypePage = {
  nPagina: number;
  nTotalPaginas: number;
  CadTiposEntrega: DeliveryType[];
};

export class DeliveryTypeError extends Error {}

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const names = new Set(["minienvios", "correiosminienvios", "minienvioscorreios"]);

/** Resolve the company's actual ID; never guess an ID or substitute another service. */
export async function resolveMiniEnvios(
  request: (params: { nPagina: number; nRegistrosPorPagina: number }) => Promise<DeliveryTypePage>,
): Promise<DeliveryType> {
  const matches: DeliveryType[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const response = await request({ nPagina: page, nRegistrosPorPagina: 100 });
    if (!Array.isArray(response.CadTiposEntrega) || !Number.isInteger(response.nPagina) || response.nPagina !== page ||
      !Number.isInteger(response.nTotalPaginas) || response.nTotalPaginas < 0 || response.nTotalPaginas > 100 ||
      (page > 1 && response.nTotalPaginas < page)) {
      throw new DeliveryTypeError("O Omie não retornou uma lista válida de tipos de entrega. Nenhum pedido foi enviado.");
    }
    totalPages = response.nTotalPaginas;
    matches.push(...response.CadTiposEntrega.filter(type => typeof type.cDescricao === "string" && names.has(normalize(type.cDescricao)) && type.cInativo === "N"));
  }
  if (!matches.length) throw new DeliveryTypeError("Mini Envios não foi encontrado como tipo de entrega ativo no Omie. Confira o cadastro antes de enviar o pedido.");
  if (matches.length !== 1) throw new DeliveryTypeError("Há mais de um tipo de entrega ativo chamado Mini Envios no Omie. Defina o cadastro correto antes de enviar o pedido.");
  const selected = matches[0];
  if (!Number.isSafeInteger(selected.nCodEntrega) || selected.nCodEntrega <= 0 ||
    (selected.nCodTransp != null && (!Number.isSafeInteger(selected.nCodTransp) || selected.nCodTransp < 0))) {
    throw new DeliveryTypeError("O cadastro Mini Envios retornou um código de entrega ou transportadora inválido. Nenhum pedido foi enviado.");
  }
  return selected;
}

export function deliveryFreight(type: DeliveryType) {
  return { codigo_tipo_entrega: type.nCodEntrega, ...(type.nCodTransp ? { codigo_transportadora: type.nCodTransp } : {}) };
}
