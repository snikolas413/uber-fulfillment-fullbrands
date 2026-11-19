type Request = <T extends Record<string, unknown>>(endpoint: string, method: string, params: Record<string, unknown>) => Promise<T>;
type Stage = { cCodigo?: string; cDescricao?: string; cDescrPadrao?: string; cInativo?: string };
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function findSeparationStage(cadastros: { cDescOperacao?: string; etapas?: Stage[] }[]) {
  const operations = cadastros.filter(row => /venda/.test(normalize(row.cDescOperacao ?? '')) &&
    !/servic|devol|remessa|compra/.test(normalize(row.cDescOperacao ?? '')));
  if (operations.length !== 1) throw new Error('Não foi possível identificar as etapas de venda de produtos no Omie. Confira a configuração.');
  const stages = operations[0].etapas?.filter(stage => stage.cInativo === 'N' && ['10','20','30','40'].includes(stage.cCodigo ?? '') &&
    /separ/.test(normalize(stage.cDescricao ?? ''))) ?? [];
  if (stages.length !== 1) throw new Error('O Omie precisa ter uma única etapa ativa de Separação antes do faturamento. Confira os nomes das etapas.');
  return stages[0].cCodigo!;
}
export async function readSeparationStage(request: Request) {
  const cadastros: { cDescOperacao?: string; etapas?: Stage[] }[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const result = await request<{ cadastros?: typeof cadastros; total_de_paginas?: number }>('/produtos/etapafat/', 'ListarEtapasFaturamento', { pagina, registros_por_pagina: 50 });
    if (!Array.isArray(result.cadastros)) throw new Error('O Omie não retornou a configuração das etapas.');
    cadastros.push(...result.cadastros);
    if (pagina >= Number(result.total_de_paginas ?? 1)) return findSeparationStage(cadastros);
  }
  throw new Error('A configuração das etapas excedeu o limite de consulta.');
}
export type SeparationSnapshot = { codigo_pedido?: number; codigo_pedido_integracao?: string; etapa?: string; cancelada?: string; faturada?: string;
  ListaNfe?: { numero_nfe?: string; chave_nfe?: string }[] };
export function assertSeparationOrder(status: SeparationSnapshot, orderId: number, integrationCode: string) {
  if (status.codigo_pedido !== orderId || status.codigo_pedido_integracao !== integrationCode) throw new Error('O vínculo do pedido com o Omie não foi confirmado.');
  if (status.cancelada !== 'N' || status.faturada !== 'N' || status.ListaNfe?.some(n => n.numero_nfe || n.chave_nfe)) {
    throw new Error('Pedido cancelado, faturado ou com situação fiscal não confirmada. Atualize o Omie antes de enviar para separação.');
  }
  if (!['10','20','30','40','50'].includes(status.etapa ?? '')) throw new Error('A etapa atual não permite envio para separação.');
}
